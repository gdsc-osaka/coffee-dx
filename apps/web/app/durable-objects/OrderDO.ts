import { and, eq, inArray, isNull } from "drizzle-orm";
import { brewUnits, menuItems, orderItems, orders } from "../../db/schema";
import { createDb } from "../lib/db";

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type OrderItemData = {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  name?: string;
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

type BrewUnitData = {
  id: string;
  batchId: string;
  menuItemId: string;
  menuItemName: string;
  orderItemId: string | null;
  status: "brewing" | "ready";
  businessDate: string;
  createdAt: string;
  updatedAt: string;
};

type ServerMessage =
  | { type: "SNAPSHOT"; orders: OrderData[]; brewUnits: BrewUnitData[] }
  | { type: "ORDER_CREATED"; order: OrderData }
  | { type: "ORDER_UPDATED"; orderId: string; status: OrderStatus }
  | { type: "BREW_UNITS_CREATED"; brewUnits: BrewUnitData[] }
  | { type: "BREW_UNIT_UPDATED"; brewUnit: BrewUnitData }
  | { type: "BREW_UNIT_DELETED"; brewUnitId: string };

export class OrderDurableObject implements DurableObject {
  private readonly orders = new Map<string, OrderData>();
  private readonly brewUnits = new Map<string, BrewUnitData>();
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

    // POST /do/new-order
    if (request.method === "POST" && url.pathname === "/do/new-order") {
      const order = (await request.json()) as OrderData;
      await this.newOrder(order);
      return new Response(null, { status: 204 });
    }

    // POST /do/brew-units  →  バッチ生成
    if (request.method === "POST" && url.pathname === "/do/brew-units") {
      return this.handleBrewUnitsCreate(request);
    }

    // POST /do/brew-units/batch/:batchId/complete  →  完了 + 紐付け
    const completeMatch = url.pathname.match(/^\/do\/brew-units\/batch\/([^/]+)\/complete$/);
    if (request.method === "POST" && completeMatch) {
      return this.handleBatchComplete(completeMatch[1]);
    }

    // POST /do/brew-units/batch/:batchId/cancel  →  brewing ユニット削除（注文に影響なし）
    const cancelMatch = url.pathname.match(/^\/do\/brew-units\/batch\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) {
      return this.handleBatchCancel(cancelMatch[1]);
    }

    // DELETE /do/brew-units/batch/:batchId  →  余剰削除（orderItemId IS NULL のみ）
    const discardMatch = url.pathname.match(/^\/do\/brew-units\/batch\/([^/]+)$/);
    if (request.method === "DELETE" && discardMatch) {
      return this.handleBatchDiscard(discardMatch[1]);
    }

    // POST /do/orders/:id/:action  →  cancel / close のみ残す
    const orderMatch = url.pathname.match(/^\/do\/orders\/([^/]+)\/([^/]+)$/);
    if (request.method === "POST" && orderMatch) {
      const [, orderId, action] = orderMatch;
      switch (action) {
        case "cancel":
          return this.transitionStatus(orderId, "cancelled", ["pending", "brewing"]);
        case "close":
          return this.transitionStatus(orderId, "completed", ["ready"]);
      }
    }

    return new Response("Not found", { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------------------

  private initPromise?: Promise<void>;

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.initPromise) {
      this.initPromise = this.state.blockConcurrencyWhile(async () => {
        const db = createDb(this.env.DB);

        // --- orders ---
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

        // --- menu name lookup（orders + brew_units 両方で使う）---
        const menuIdSet = new Set(allItems.map((i) => i.menuItemId));

        // brew_units の menuItemId も先読みするため、brew_units も先に取得
        const activeBrewUnitsRaw = await db
          .select()
          .from(brewUnits)
          .where(inArray(brewUnits.status, ["brewing", "ready"]));

        for (const u of activeBrewUnitsRaw) menuIdSet.add(u.menuItemId);

        const menuRecords =
          menuIdSet.size > 0
            ? await db
                .select({ id: menuItems.id, name: menuItems.name })
                .from(menuItems)
                .where(inArray(menuItems.id, [...menuIdSet]))
            : [];
        const menuNameById = new Map(menuRecords.map((m) => [m.id, m.name]));

        // orders をインメモリに展開
        const itemsByOrderId = new Map<string, OrderItemData[]>();
        for (const item of allItems) {
          if (!itemsByOrderId.has(item.orderId)) itemsByOrderId.set(item.orderId, []);
          itemsByOrderId.get(item.orderId)!.push({
            ...item,
            name: menuNameById.get(item.menuItemId),
          });
        }
        for (const order of activeOrders) {
          this.orders.set(order.id, {
            ...order,
            status: order.status as OrderStatus,
            items: itemsByOrderId.get(order.id) ?? [],
          });
        }

        // brew_units をインメモリに展開
        for (const u of activeBrewUnitsRaw) {
          this.brewUnits.set(u.id, {
            id: u.id,
            batchId: u.batchId,
            menuItemId: u.menuItemId,
            menuItemName: menuNameById.get(u.menuItemId) ?? "",
            orderItemId: u.orderItemId,
            status: u.status as "brewing" | "ready",
            businessDate: u.businessDate,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          });
        }

        this.initialized = true;
      });
    }

    return this.initPromise;
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  private async handleWebSocket(): Promise<Response> {
    await this.initialize();

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.sessions.add(server);

    const snapshotOrders = Array.from(this.orders.values()).filter(
      (o) => o.status !== "completed" && o.status !== "cancelled",
    );
    const snapshotBrewUnits = Array.from(this.brewUnits.values());
    server.send(
      JSON.stringify({
        type: "SNAPSHOT",
        orders: snapshotOrders,
        brewUnits: snapshotBrewUnits,
      }),
    );

    server.addEventListener("close", () => this.sessions.delete(server));
    server.addEventListener("error", () => this.sessions.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------------------
  // 注文作成
  // ---------------------------------------------------------------------------

  private async newOrder(order: OrderData): Promise<void> {
    this.orders.set(order.id, order);
    this.broadcast({ type: "ORDER_CREATED", order });

    // 既存の ready・未紐付けユニットがあれば自動割り当て
    await this.autoAssignReadyUnits(order);
  }

  /**
   * 新規注文の order_items に対して、既に ready で未紐付けの BrewUnit を割り当てる。
   * complete と同じ紐付けロジックを order 単体に適用する。
   */
  private async autoAssignReadyUnits(order: OrderData): Promise<void> {
    const db = createDb(this.env.DB);
    const now = new Date().toISOString();
    let anyAssigned = false;

    for (const item of order.items) {
      const alreadyLinked = [...this.brewUnits.values()].filter(
        (u) => u.orderItemId === item.id && u.status === "ready",
      ).length;
      const needed = item.quantity - alreadyLinked;
      if (needed <= 0) continue;

      // orderItemId IS NULL かつ ready のユニット（createdAt 昇順）
      const candidates = [...this.brewUnits.values()]
        .filter(
          (u) => u.menuItemId === item.menuItemId && u.status === "ready" && u.orderItemId === null,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, needed);

      for (const unit of candidates) {
        await this.writeWithRetry(() =>
          db
            .update(brewUnits)
            .set({ orderItemId: item.id, updatedAt: now })
            .where(and(eq(brewUnits.id, unit.id), isNull(brewUnits.orderItemId))),
        );
        unit.orderItemId = item.id;
        unit.updatedAt = now;
        this.brewUnits.set(unit.id, unit);
        this.broadcast({ type: "BREW_UNIT_UPDATED", brewUnit: { ...unit } });
        anyAssigned = true;
      }
    }

    if (anyAssigned) {
      this.evaluateOrderStatus(order.id);
    }
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: バッチ生成
  // ---------------------------------------------------------------------------

  private async handleBrewUnitsCreate(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      menuItemId: string;
      count: number;
      businessDate: string;
    };
    const { menuItemId, count, businessDate } = body;

    if (!menuItemId || !count || count < 1) return new Response("Invalid body", { status: 400 });

    const db = createDb(this.env.DB);

    // メニュー名を取得
    const menuRecord = await db
      .select({ id: menuItems.id, name: menuItems.name })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId))
      .get();
    if (!menuRecord) return new Response("Menu item not found", { status: 404 });

    const batchId = crypto.randomUUID();
    const now = new Date().toISOString();
    const newUnits: BrewUnitData[] = Array.from({ length: count }, () => ({
      id: crypto.randomUUID(),
      batchId,
      menuItemId,
      menuItemName: menuRecord.name,
      orderItemId: null,
      status: "brewing" as const,
      businessDate,
      createdAt: now,
      updatedAt: now,
    }));

    await this.writeWithRetry(() =>
      db.insert(brewUnits).values(
        newUnits.map((u) => ({
          id: u.id,
          batchId: u.batchId,
          menuItemId: u.menuItemId,
          orderItemId: null,
          status: u.status,
          businessDate: u.businessDate,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
      ),
    );

    for (const u of newUnits) this.brewUnits.set(u.id, u);
    this.broadcast({ type: "BREW_UNITS_CREATED", brewUnits: newUnits });

    return new Response(null, { status: 204 });
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: バッチ完了 + 先着順紐付け（競合防止: DO のシングルスレッドを活用）
  // ---------------------------------------------------------------------------

  private async handleBatchComplete(batchId: string): Promise<Response> {
    const db = createDb(this.env.DB);
    const now = new Date().toISOString();

    // 1. バッチ内の brewing ユニットを ready に更新
    const batchUnits = [...this.brewUnits.values()].filter(
      (u) => u.batchId === batchId && u.status === "brewing",
    );
    if (batchUnits.length === 0)
      return new Response("Batch not found or already completed", {
        status: 404,
      });

    await this.writeWithRetry(() =>
      db
        .update(brewUnits)
        .set({ status: "ready", updatedAt: now })
        .where(and(eq(brewUnits.batchId, batchId), eq(brewUnits.status, "brewing"))),
    );
    for (const u of batchUnits) {
      u.status = "ready";
      u.updatedAt = now;
      this.brewUnits.set(u.id, u);
    }

    // 2. ready かつ未紐付けのユニットをメニューごとに集計
    //    （このバッチ分だけでなく既存の余剰も含める）
    const readyUnassigned = [...this.brewUnits.values()].filter(
      (u) => u.status === "ready" && u.orderItemId === null,
    );
    // menuItemId → ready 未紐付けユニット（createdAt 昇順）
    const poolByMenu = new Map<string, BrewUnitData[]>();
    for (const u of readyUnassigned) {
      if (!poolByMenu.has(u.menuItemId)) poolByMenu.set(u.menuItemId, []);
      poolByMenu.get(u.menuItemId)!.push(u);
    }
    for (const pool of poolByMenu.values()) {
      pool.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    // 3. pending / brewing 注文を createdAt 昇順で取得し、不足分を紐付け
    const activeOrders = [...this.orders.values()]
      .filter((o) => o.status === "pending" || o.status === "brewing")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const affectedOrderIds = new Set<string>();

    for (const order of activeOrders) {
      for (const item of order.items) {
        const pool = poolByMenu.get(item.menuItemId);
        if (!pool || pool.length === 0) continue;

        const alreadyLinked = [...this.brewUnits.values()].filter(
          (u) => u.orderItemId === item.id && u.status === "ready",
        ).length;
        const needed = item.quantity - alreadyLinked;
        if (needed <= 0) continue;

        const toAssign = pool.splice(0, needed); // pool から取り出す
        for (const unit of toAssign) {
          await this.writeWithRetry(() =>
            db
              .update(brewUnits)
              .set({ orderItemId: item.id, updatedAt: now })
              .where(eq(brewUnits.id, unit.id)),
          );
          unit.orderItemId = item.id;
          unit.updatedAt = now;
          this.brewUnits.set(unit.id, unit);
          affectedOrderIds.add(order.id);
        }
      }
    }

    // 4. broadcast: BREW_UNIT_UPDATED（バッチ内の全ユニット）
    for (const u of batchUnits) {
      this.broadcast({ type: "BREW_UNIT_UPDATED", brewUnit: { ...u } });
    }

    // 5. 影響注文のステータス評価
    for (const orderId of affectedOrderIds) {
      this.evaluateAndBroadcastOrderStatus(orderId);
    }

    return new Response(null, { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: バッチ取り消し（brewing のみ削除、注文には影響なし）
  // ---------------------------------------------------------------------------

  private async handleBatchCancel(batchId: string): Promise<Response> {
    const db = createDb(this.env.DB);

    // 削除条件: status='brewing' AND order_item_id IS NULL の両方を明示する。
    // 遅延バインディング設計では brewing ユニットは常に orderItemId=null のため論理的に同値だが、
    // 不変条件が壊れた場合の安全網として両条件を AND で指定し、ready や紐付き済みユニットは一切触れない。
    const targetUnits = [...this.brewUnits.values()].filter(
      (u) => u.batchId === batchId && u.status === "brewing" && u.orderItemId === null,
    );
    // 0 件: バッチが既に complete 済みか、存在しないバッチ → 404
    if (targetUnits.length === 0)
      return new Response("Batch not found or not cancellable", { status: 404 });

    await this.writeWithRetry(() =>
      db
        .delete(brewUnits)
        .where(
          and(
            eq(brewUnits.batchId, batchId),
            eq(brewUnits.status, "brewing"),
            isNull(brewUnits.orderItemId),
          ),
        ),
    );

    for (const u of targetUnits) {
      this.brewUnits.delete(u.id);
      this.broadcast({ type: "BREW_UNIT_DELETED", brewUnitId: u.id });
    }

    return new Response(null, { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: 余剰削除（orderItemId IS NULL のみ）
  // ---------------------------------------------------------------------------

  private async handleBatchDiscard(batchId: string): Promise<Response> {
    const db = createDb(this.env.DB);

    const targetUnits = [...this.brewUnits.values()].filter(
      (u) => u.batchId === batchId && u.orderItemId === null,
    );
    if (targetUnits.length === 0) return new Response("No surplus units found", { status: 404 });

    await this.writeWithRetry(() =>
      db
        .delete(brewUnits)
        .where(and(eq(brewUnits.batchId, batchId), isNull(brewUnits.orderItemId))),
    );

    for (const u of targetUnits) {
      this.brewUnits.delete(u.id);
      this.broadcast({ type: "BREW_UNIT_DELETED", brewUnitId: u.id });
    }

    return new Response(null, { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // 注文ステータス自動遷移
  // ---------------------------------------------------------------------------

  /**
   * 紐付き BrewUnit（必然的に ready のみ）を確認し、全杯揃っていれば orders.status を ready に遷移。
   * brewing 遷移は DB には持たせず、Cashier フロントエンドが仮想計算で表現する。
   */
  private evaluateOrderStatus(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order || order.status === "cancelled" || order.status === "completed") return;

    const linkedReady = [...this.brewUnits.values()].filter(
      (u) => order.items.some((item) => item.id === u.orderItemId) && u.status === "ready",
    );

    const allReady = order.items.every(
      (item) => linkedReady.filter((u) => u.orderItemId === item.id).length >= item.quantity,
    );

    if (allReady && order.status !== "ready") {
      // 非同期で DB 更新 + broadcast（fire-and-forget; DO シングルスレッドなので競合なし）
      void this.transitionStatus(orderId, "ready", ["pending", "brewing"]);
    }
  }

  private evaluateAndBroadcastOrderStatus(orderId: string): void {
    this.evaluateOrderStatus(orderId);
  }

  // ---------------------------------------------------------------------------
  // 共通: 注文ステータス遷移（DB + インメモリ + broadcast）
  // ---------------------------------------------------------------------------

  private async transitionStatus(
    orderId: string,
    targetStatus: OrderStatus,
    expectedStatuses: OrderStatus[],
  ): Promise<Response> {
    const order = this.orders.get(orderId);
    if (!order) return new Response("Order not found", { status: 404 });

    if (order.status === targetStatus) return new Response(null, { status: 200 });

    if (!expectedStatuses.includes(order.status)) {
      return new Response(`Conflict: Order status is currently ${order.status}`, { status: 409 });
    }

    const newUpdatedAt = new Date().toISOString();
    const db = createDb(this.env.DB);
    const result = await this.writeWithRetry(() =>
      db
        .update(orders)
        .set({ status: targetStatus, updatedAt: newUpdatedAt })
        .where(and(eq(orders.id, orderId), inArray(orders.status, expectedStatuses))),
    );

    if ((result as D1Result).meta?.changes === 0) {
      return new Response("Conflict: D1 state was unexpectedly changed", {
        status: 409,
      });
    }

    order.status = targetStatus;
    order.updatedAt = newUpdatedAt;
    this.broadcast({ type: "ORDER_UPDATED", orderId, status: targetStatus });

    if (targetStatus === "completed" || targetStatus === "cancelled") {
      this.orders.delete(orderId);
    }

    return new Response(null, { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // ユーティリティ
  // ---------------------------------------------------------------------------

  // Exponential backoff リトライ（最大 3 回: 200ms → 400ms）
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
