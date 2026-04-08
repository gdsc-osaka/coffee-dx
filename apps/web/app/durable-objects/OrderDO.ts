import { and, eq, inArray, sql } from "drizzle-orm";
import { orderItems, orders } from "../../db/schema";
import { createDb } from "../lib/db";

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type OrderItemData = {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
};

type OrderData = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: OrderItemData[];
};

type ServerMessage =
  | { type: "SNAPSHOT"; orders: OrderData[] }
  | { type: "ORDER_CREATED"; order: OrderData }
  | { type: "ORDER_UPDATED"; orderId: string; status: OrderStatus };

export class OrderDurableObject implements DurableObject {
  private readonly orders = new Map<string, OrderData>();
  private readonly sessions = new Set<WebSocket>();
  private initialized = false;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket();
    }

    await this.initialize();

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // POST /do/new-order  （Worker から注文作成後に呼び出す）
    if (url.pathname === "/do/new-order") {
      const order = (await request.json()) as OrderData;
      this.newOrder(order);
      return new Response(null, { status: 204 });
    }

    // POST /do/orders/:id/:action
    const match = url.pathname.match(/^\/do\/orders\/([^/]+)\/([^/]+)$/);
    if (match) {
      const [, orderId, action] = match;
      switch (action) {
        case "cancel":
          return this.transitionStatus(orderId, "cancelled", ["pending", "brewing"]);
        case "start":
          return this.transitionStatus(orderId, "brewing", ["pending"]);
        case "complete-brew":
          return this.transitionStatus(orderId, "ready", ["brewing"]);
        case "close":
          return this.transitionStatus(orderId, "completed", ["ready"]);
      }
    }

    return new Response("Not found", { status: 404 });
  }

  private initPromise?: Promise<void>;

  // DO 再起動時に D1 から進行中の注文を復元する
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.initPromise) {
      this.initPromise = this.state.blockConcurrencyWhile(async () => {
        const db = createDb(this.env.DB);
        const activeOrders = await db
          .select()
          .from(orders)
          .where(inArray(orders.status, ["pending", "brewing", "ready"]));

        const allItems =
          activeOrders.length > 0
            ? await db
                .select()
                .from(orderItems)
                .where(
                  inArray(
                    orderItems.orderId,
                    activeOrders.map((o) => o.id),
                  ),
                )
            : [];

        const itemsByOrderId = new Map<string, typeof allItems>();
        for (const item of allItems) {
          if (!itemsByOrderId.has(item.orderId)) {
            itemsByOrderId.set(item.orderId, []);
          }
          itemsByOrderId.get(item.orderId)!.push(item);
        }

        for (const order of activeOrders) {
          this.orders.set(order.id, {
            ...order,
            status: order.status as OrderStatus,
            items: itemsByOrderId.get(order.id) || [],
          });
        }

        this.initialized = true;
      });
    }

    return this.initPromise;
  }

  private async handleWebSocket(): Promise<Response> {
    await this.initialize();

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.sessions.add(server);

    // 接続直後に進行中の注文を全件送信
    const snapshot = Array.from(this.orders.values()).filter(
      (o) => o.status !== "completed" && o.status !== "cancelled",
    );
    server.send(JSON.stringify({ type: "SNAPSHOT", orders: snapshot }));

    server.addEventListener("close", () => this.sessions.delete(server));
    server.addEventListener("error", () => this.sessions.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private newOrder(order: OrderData): void {
    this.orders.set(order.id, order);
    this.broadcast({ type: "ORDER_CREATED", order });
  }

  // 冪等チェック → メモリでの同期状態チェック → D1 同期書き込み（楽観ロック） → リザルト確認 → メモリ更新 → ブロードキャスト
  private async transitionStatus(
    orderId: string,
    targetStatus: OrderStatus,
    expectedStatuses: OrderStatus[],
  ): Promise<Response> {
    const order = this.orders.get(orderId);
    if (!order) return new Response("Order not found", { status: 404 });

    // 冪等チェック：既に目標ステータスなら即 200
    if (order.status === targetStatus) return new Response(null, { status: 200 });

    // DOのシングルスレッド特性を活かして、await前にメモリ上のステータスを同期チェック
    if (!expectedStatuses.includes(order.status)) {
      return new Response(`Conflict: Order status is currently ${order.status}`, { status: 409 });
    }

    const db = createDb(this.env.DB);
    const result = await this.writeWithRetry(() =>
      db
        .update(orders)
        .set({
          status: targetStatus,
          updatedAt: sql`(datetime('now', '+9 hours'))`,
        })
        .where(and(eq(orders.id, orderId), inArray(orders.status, expectedStatuses))),
    );

    // 楽観ロック: D1のステータスが別のリクエストで書き換えられており更新対象が0行だった場合
    if ((result as any).meta?.changes === 0) {
      return new Response("Conflict: D1 state was unexpectedly changed", { status: 409 });
    }

    order.status = targetStatus;
    this.broadcast({ type: "ORDER_UPDATED", orderId, status: targetStatus });
    return new Response(null, { status: 200 });
  }

  // Exponential backoff リトライ（最大3回: 200ms → 400ms）
  private async writeWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i === attempts - 1) {
          console.error("[OrderDO] D1 write failed after retries", e);
          throw e;
        }
        await new Promise((r) => setTimeout(r, 200 * 2 ** i));
      }
    }
    throw new Error("Unreachable");
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(payload);
      } catch {
        this.sessions.delete(session);
      }
    }
  }
}
