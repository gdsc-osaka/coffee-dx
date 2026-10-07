import { eq, inArray, sql } from "drizzle-orm";
import { menuItems, orderItems, orderNumberCounters, orders } from "../../../db/schema";
import { createDb } from "../../lib/db";
import { getJstNowString, parseJstString } from "../../lib/datetime";
import { callOrderDO, getBusinessDate, getOrderDOStub } from "../../lib/order-do";

type Db = ReturnType<typeof createDb>;

export type CartItem = {
  menuItemId: string;
  /** UI表示用。注文の確定値としては使用しない。 */
  name?: string;
  /** 旧クライアント互換用。注文の確定値としては使用しない。 */
  price?: number;
  /** 未指定の場合は menu_items.price を使用する。 */
  unitPriceAtOrder?: number;
  quantity: number;
};

export async function createOrder(
  db: Db,
  env: Env,
  cartItems: CartItem[],
  options?: { isFree?: boolean },
): Promise<{ orderId: string; orderNumber: number; createdAt: Date; isFree: boolean }> {
  const businessDate = getBusinessDate();
  const now = getJstNowString();
  const isFree = options?.isFree ?? false;

  if (cartItems.length === 0) {
    throw new Error("Cart must not be empty");
  }

  const menuItemIds = [...new Set(cartItems.map((item) => item.menuItemId))];
  const menuItemRecords = await db
    .select()
    .from(menuItems)
    .where(inArray(menuItems.id, menuItemIds));
  const menuItemMap = new Map(menuItemRecords.map((m) => [m.id, m]));

  for (const item of cartItems) {
    const menuItem = menuItemMap.get(item.menuItemId);
    if (!menuItem) throw new Error(`Menu item not found: ${item.menuItemId}`);
    if (menuItem.isAvailable !== 1) throw new Error(`Menu item is unavailable: ${item.menuItemId}`);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Quantity must be a positive integer");
    }

    const unitPrice = item.unitPriceAtOrder ?? menuItem.price;
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
      throw new Error("Unit price must be a non-negative integer");
    }
  }

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
  const orderItemsData = cartItems.map((item) => {
    const menuItem = menuItemMap.get(item.menuItemId)!;
    return {
      id: crypto.randomUUID(),
      orderId,
      menuItemId: item.menuItemId,
      unitPriceAtOrder: item.unitPriceAtOrder ?? menuItem.price,
      fulfillmentTypeAtOrder: menuItem.fulfillmentType,
      quantity: item.quantity,
      createdAt: now,
      updatedAt: now,
    };
  });
  const hasBrewItems = orderItemsData.some((item) => item.fulfillmentTypeAtOrder === "brew");
  const initialStatus = hasBrewItems ? "pending" : "completed";

  // orders + orderItems をアトミックに INSERT する（D1 は batch 内のクエリを 1 トランザクションで実行する）
  // これにより orderItems INSERT 失敗時に orders だけが孤児として残るケースを防ぐ。
  await db.batch([
    db.insert(orders).values({
      id: orderId,
      businessDate,
      orderNumber,
      status: initialStatus,
      isFree: isFree ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(orderItems).values(orderItemsData),
  ]);

  // direct商品のみの注文は抽出処理が不要なのでDOに通知しない。
  if (!hasBrewItems) {
    return { orderId, orderNumber, createdAt: parseJstString(now), isFree };
  }

  // DO に新規注文を通知（失敗時は D1 の注文を削除して整合性を保つ）
  const stub = getOrderDOStub(env, businessDate);
  try {
    await callOrderDO(stub, businessDate, "/do/new-order", {
      body: {
        id: orderId,
        orderNumber,
        status: initialStatus,
        isFree,
        createdAt: now,
        updatedAt: now,
        items: orderItemsData.map((item) => ({
          ...item,
          name: menuItemMap.get(item.menuItemId)?.name ?? "",
        })),
      },
    });
  } catch (err) {
    // DO 通知失敗時は D1 に書き込んだ注文を削除してロールバック（orderItems は CASCADE で連鎖削除）
    await db.delete(orders).where(eq(orders.id, orderId));
    throw err;
  }

  return { orderId, orderNumber, createdAt: parseJstString(now), isFree };
}
