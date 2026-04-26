import { eq, inArray, sql } from "drizzle-orm";
import { menuItems, orderItems, orderNumberCounters, orders } from "../../../db/schema";
import { createDb } from "../../lib/db";
import { getJstNowString, parseJstString } from "../../lib/datetime";
import { callOrderDO, getBusinessDate, getOrderDOStub } from "../../lib/order-do";

type Db = ReturnType<typeof createDb>;

export type CartItem = {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
};

export async function createOrder(
  db: Db,
  env: Env,
  cartItems: CartItem[],
): Promise<{ orderId: string; orderNumber: number; createdAt: Date }> {
  const businessDate = getBusinessDate();
  const now = getJstNowString();

  // 注文番号採番（UPSERT + RETURNING で原子的にインクリメント済み値を取得）
  //
  // nextNumber は「次に発番する番号」ではなく「この行を書き込んだ時点の最新発番値 + 1」を保持する。
  //   - 初回挿入: nextNumber=2 を書き込み → RETURNING で 2 を受け取り → orderNumber = 2 - 1 = 1
  //   - 2回目以降: nextNumber = nextNumber + 1 で更新 → RETURNING で更新後の値を受け取り → - 1 が今回の発番値
  // SQLite の RETURNING は ON CONFLICT DO UPDATE 時に「更新後」の行を返すことに依存している。
  const [counter] = await db
    .insert(orderNumberCounters)
    .values({ businessDate, nextNumber: 2, updatedAt: now })
    .onConflictDoUpdate({
      target: orderNumberCounters.businessDate,
      set: {
        nextNumber: sql`${orderNumberCounters.nextNumber} + 1`,
        updatedAt: now,
      },
    })
    .returning({ nextNumber: orderNumberCounters.nextNumber });

  const orderNumber = counter.nextNumber - 1;
  const orderId = crypto.randomUUID();

  // orderItems に使う ID を事前に生成（DO 通知と同じ ID を使うため）
  const orderItemsData = cartItems.map((item) => ({
    id: crypto.randomUUID(),
    orderId,
    menuItemId: item.menuItemId,
    quantity: item.quantity,
    createdAt: now,
    updatedAt: now,
  }));

  // メニュー情報を取得してDOに渡す
  const menuItemIds = cartItems.map((item) => item.menuItemId);
  const menuItemRecords = await db
    .select()
    .from(menuItems)
    .where(inArray(menuItems.id, menuItemIds));

  const menuItemMap = new Map(menuItemRecords.map((m) => [m.id, m]));

  // orders + orderItems をアトミックに INSERT する（D1 は batch 内のクエリを 1 トランザクションで実行する）
  // これにより orderItems INSERT 失敗時に orders だけが孤児として残るケースを防ぐ。
  await db.batch([
    db.insert(orders).values({
      id: orderId,
      orderNumber,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(orderItems).values(orderItemsData),
  ]);

  // DO に新規注文を通知（失敗時は D1 の注文を削除して整合性を保つ）
  const stub = getOrderDOStub(env, businessDate);
  try {
    await callOrderDO(stub, "/do/new-order", {
      id: orderId,
      orderNumber,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      items: orderItemsData.map((item) => ({
        ...item,
        name: menuItemMap.get(item.menuItemId)?.name ?? "",
      })),
    });
  } catch (err) {
    // DO 通知失敗時は D1 に書き込んだ注文を削除してロールバック（orderItems は CASCADE で連鎖削除）
    await db.delete(orders).where(eq(orders.id, orderId));
    throw err;
  }

  return { orderId, orderNumber, createdAt: parseJstString(now) };
}
