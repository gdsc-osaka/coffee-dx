import { eq, inArray, sql } from "drizzle-orm";
import { menuItems, orderItems, orderNumberCounters, orders } from "../../../db/schema";
import { createDb } from "../../lib/db";
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
): Promise<{ orderId: string; orderNumber: number }> {
  const businessDate = getBusinessDate();

  // 注文番号採番（UPSERT でインクリメント）
  await db
    .insert(orderNumberCounters)
    .values({ businessDate, nextNumber: 2 })
    .onConflictDoUpdate({
      target: orderNumberCounters.businessDate,
      set: { nextNumber: sql`${orderNumberCounters.nextNumber} + 1` },
    });

  const [counter] = await db
    .select()
    .from(orderNumberCounters)
    .where(eq(orderNumberCounters.businessDate, businessDate));

  const orderNumber = counter.nextNumber - 1;
  const orderId = crypto.randomUUID();
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  // orders INSERT
  await db.insert(orders).values({
    id: orderId,
    orderNumber,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  // orderItems INSERT
  await db.insert(orderItems).values(
    cartItems.map((item) => ({
      id: crypto.randomUUID(),
      orderId,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      createdAt: now,
      updatedAt: now,
    })),
  );

  // メニュー情報を取得してDOに渡す
  const menuItemIds = cartItems.map((item) => item.menuItemId);
  const menuItemRecords = await db
    .select()
    .from(menuItems)
    .where(inArray(menuItems.id, menuItemIds));

  const menuItemMap = new Map(menuItemRecords.map((m) => [m.id, m]));

  // DO に新規注文を通知
  const stub = getOrderDOStub(env, businessDate);
  await callOrderDO(stub, "/do/new-order", {
    id: orderId,
    orderNumber,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    items: cartItems.map((item) => ({
      id: crypto.randomUUID(),
      orderId,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      name: menuItemMap.get(item.menuItemId)?.name ?? item.name,
      createdAt: now,
      updatedAt: now,
    })),
  });

  return { orderId, orderNumber };
}
