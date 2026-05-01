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
  /** ドリップ係が抽出開始時に指定したタイマー秒数。NULL は未指定。 */
  targetDurationSec: number | null;
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
  // この DO が紐づく eventId（= business_date）。Worker 境界で検証済みの値が x-event-id に乗ってくる前提で、
  // brew_units を書き込む際の真実源として使う。
  private eventId: string | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const headerEventId = request.headers.get("x-event-id");
    if (!headerEventId) {
      return new Response("Missing x-event-id header", { status: 400 });
    }
    this.eventId = headerEventId;

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

    // DELETE /do/brew-units/menu/:menuId/surplus  →  メニューごとの余剰削除（1件ずつ）
    const surplusMatch = url.pathname.match(/^\/do\/brew-units\/menu\/([^/]+)\/surplus$/);
    if (request.method === "DELETE" && surplusMatch) {
      return this.handleMenuSurplusDecrease(surplusMatch[1]);
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

    // fetch() で x-event-id を必ず先にセットしてから initialize() を呼ぶ前提。
    // 別 event の brew_units まで取り込まないよう、businessDate スコープ用に確定させる。
    const eventId = this.eventId;
    if (!eventId) {
      throw new Error("[OrderDO] initialize called before eventId was set");
    }

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

        // brew_units の menuItemId も先読みするため、brew_units も先に取得。
        // DO は event 単位（idFromName('event-${eventId}')）で分離されるが、D1 は event 横断で
        // 共有のため、businessDate で必ず絞らないと再起動時に別 event のユニットを取り込んでしまう。
        const activeBrewUnitsRaw = await db
          .select()
          .from(brewUnits)
          .where(
            and(
              inArray(brewUnits.status, ["brewing", "ready"]),
              eq(brewUnits.businessDate, eventId),
            ),
          );

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

        // activeな注文のアイテムID一覧
        const activeOrderItemsSet = new Set(allItems.map((i) => i.id));

        // brew_units をインメモリに展開
        for (const u of activeBrewUnitsRaw) {
          // SQL 側で businessDate=eventId に絞っているが、メモリ展開でも同条件を再確認する。
          // 将来クエリ条件が変わっても別 event のユニットが DO 内に紛れ込まないための防御深度。
          if (u.businessDate !== eventId) continue;

          // 提供済み（完了/キャンセル済みの注文に紐づく）brew_unit は DO の管理対象外とする
          if (u.orderItemId && !activeOrderItemsSet.has(u.orderItemId)) {
            continue;
          }

          this.brewUnits.set(u.id, {
            id: u.id,
            batchId: u.batchId,
            menuItemId: u.menuItemId,
            menuItemName: menuNameById.get(u.menuItemId) ?? "",
            orderItemId: u.orderItemId,
            status: u.status as "brewing" | "ready",
            targetDurationSec: u.targetDurationSec,
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
    // handleBatchComplete と同じ ready 未紐付けプールを取り合うため、
    // setTimeout バックオフ越しの interleave を防ぐ目的で全体を直列化する。
    await this.state.blockConcurrencyWhile(async () => {
      this.orders.set(order.id, order);
      this.broadcast({ type: "ORDER_CREATED", order });

      // 既存の ready・未紐付けユニットがあれば自動割り当て
      await this.autoAssignReadyUnits(order);
    });
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
        const result = await this.writeWithRetry(() =>
          db
            .update(brewUnits)
            .set({ orderItemId: item.id, updatedAt: now })
            .where(and(eq(brewUnits.id, unit.id), isNull(brewUnits.orderItemId))),
        );

        // 競合により他リクエストが先に紐付けた場合は changes=0。
        // DB と整合させるためメモリ更新/broadcast をスキップする。
        if ((result as D1Result).meta?.changes === 0) continue;

        unit.orderItemId = item.id;
        unit.updatedAt = now;
        this.brewUnits.set(unit.id, unit);
        this.broadcast({ type: "BREW_UNIT_UPDATED", brewUnit: { ...unit } });
        anyAssigned = true;
      }
    }

    if (anyAssigned) {
      await this.evaluateOrderStatus(order.id);
    }
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: バッチ生成
  // ---------------------------------------------------------------------------

  private async handleBrewUnitsCreate(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      menuItemId: string;
      count: number;
      targetDurationSec?: number | null;
    };
    const { menuItemId, count } = body;
    const targetDurationSec =
      typeof body.targetDurationSec === "number" && body.targetDurationSec > 0
        ? Math.floor(body.targetDurationSec)
        : null;

    if (!menuItemId || !count || count < 1) return new Response("Invalid body", { status: 400 });

    // business_date は DO 自身が保持する eventId を真実源とする（クライアント任せにしない）
    const businessDate = this.eventId;
    if (!businessDate) return new Response("Missing eventId context", { status: 400 });

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
      targetDurationSec,
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
          targetDurationSec: u.targetDurationSec,
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
    const eventId = this.eventId;
    if (!eventId) return new Response("Missing eventId context", { status: 400 });

    // バッチ完了→プール作成→紐付けは複数の await を跨ぐ。D1 アクセスは DO の Input Gate
    // の保護外であり、writeWithRetry の setTimeout バックオフでも Gate が開放されるため、
    // 並走する new-order / 別 complete との interleave で割り当てが二重化しうる。
    // 処理全体を blockConcurrencyWhile で直列化したうえで、紐付け UPDATE 自体も
    // order_item_id IS NULL + changes チェックで上書きを防ぐ二重防御とする。
    return this.state.blockConcurrencyWhile(async () => {
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
          .where(
            and(
              eq(brewUnits.businessDate, eventId),
              eq(brewUnits.batchId, batchId),
              eq(brewUnits.status, "brewing"),
            ),
          ),
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
      // 更新があったユニット ID を集約。バッチ内ユニット（brewing→ready）に加え、
      // 既存の余剰から紐付けされたユニット（バッチ外）も含めて 1 回ずつ broadcast する。
      const updatedUnitIds = new Set<string>(batchUnits.map((u) => u.id));

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
            const result = await this.writeWithRetry(() =>
              db
                .update(brewUnits)
                .set({ orderItemId: item.id, updatedAt: now })
                .where(and(eq(brewUnits.id, unit.id), isNull(brewUnits.orderItemId))),
            );

            // 競合により他リクエストが先に紐付けた場合は changes=0。
            // DB と整合させるためメモリ更新/broadcast をスキップする。
            if ((result as D1Result).meta?.changes === 0) continue;

            unit.orderItemId = item.id;
            unit.updatedAt = now;
            this.brewUnits.set(unit.id, unit);
            updatedUnitIds.add(unit.id);
            affectedOrderIds.add(order.id);
          }
        }
      }

      // 4. 影響注文のステータス評価（ORDER_UPDATED を先に broadcast）。
      //    Cashier の virtualOrders は brew_units の ready 数だけで displayStatus=ready を
      //    決めうるため、BREW_UNIT_UPDATED を先に投げると「クライアントは ready 表示・
      //    サーバ order.status は pending」の窓ができ、close 押下で 409 になりうる。
      //    ORDER_UPDATED を先送りすればその窓が発生しない。
      for (const orderId of affectedOrderIds) {
        await this.evaluateAndBroadcastOrderStatus(orderId);
      }

      // 5. broadcast: BREW_UNIT_UPDATED（更新があった全ユニット）
      for (const id of updatedUnitIds) {
        const u = this.brewUnits.get(id);
        if (u) this.broadcast({ type: "BREW_UNIT_UPDATED", brewUnit: { ...u } });
      }

      return new Response(null, { status: 200 });
    });
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: バッチ取り消し（brewing のみ削除、注文には影響なし）
  // ---------------------------------------------------------------------------

  private async handleBatchCancel(batchId: string): Promise<Response> {
    // writeWithRetry の setTimeout バックオフで JS タスクが yield する間に handleBatchComplete
    // 等が割り込むと、SQL は status='brewing' ガードで残すユニットをメモリ側でスナップショットを
    // 信じて消してしまい、D1 とメモリ・クライアント表示が乖離する。blockConcurrencyWhile で
    // スナップショット〜DELETE〜メモリ更新を直列化して TOCTOU を排除する。
    return this.state.blockConcurrencyWhile(async () => {
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
    });
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: 余剰削除（メニュー単位で1件）
  // ---------------------------------------------------------------------------

  private async handleMenuSurplusDecrease(menuItemId: string): Promise<Response> {
    const db = createDb(this.env.DB);

    // ready かつ未紐付きの同メニューユニットを取得（古いものから）
    const targetUnits = [...this.brewUnits.values()]
      .filter((u) => u.menuItemId === menuItemId && u.status === "ready" && u.orderItemId === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (targetUnits.length === 0) {
      return new Response("No surplus units found for this menu", { status: 404 });
    }

    const targetUnit = targetUnits[0];

    // await 中に他リクエストが当該ユニットを紐付け／状態変更する可能性があるため、
    // DB 側でも business_date / status / order_item_id を再確認して安全に削除する。
    const result = await this.writeWithRetry(() =>
      db
        .delete(brewUnits)
        .where(
          and(
            eq(brewUnits.id, targetUnit.id),
            eq(brewUnits.businessDate, targetUnit.businessDate),
            eq(brewUnits.status, "ready"),
            isNull(brewUnits.orderItemId),
          ),
        ),
    );

    if ((result as D1Result).meta?.changes === 0) {
      // 別リクエストが先に紐付け／削除した。in-memory も触らず 409 を返す。
      return new Response("Conflict: surplus unit was modified concurrently", { status: 409 });
    }

    this.brewUnits.delete(targetUnit.id);
    this.broadcast({ type: "BREW_UNIT_DELETED", brewUnitId: targetUnit.id });

    return new Response(null, { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // 注文ステータス自動遷移
  // ---------------------------------------------------------------------------

  /**
   * 紐付き BrewUnit（必然的に ready のみ）を確認し、全杯揃っていれば orders.status を ready に遷移。
   * brewing 遷移は DB には持たせず、Cashier フロントエンドが仮想計算で表現する。
   */
  private async evaluateOrderStatus(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order || order.status === "cancelled" || order.status === "completed") return;

    const linkedReady = [...this.brewUnits.values()].filter(
      (u) => order.items.some((item) => item.id === u.orderItemId) && u.status === "ready",
    );

    const allReady = order.items.every(
      (item) => linkedReady.filter((u) => u.orderItemId === item.id).length >= item.quantity,
    );

    if (allReady && order.status !== "ready") {
      // D1 更新失敗時はリトライ後に throw され、呼び出し元のリクエストが 5xx で失敗する。
      // クライアント側の再試行に委ねる（ここで握り潰すと brew_units と orders.status が乖離するため）。
      await this.transitionStatus(orderId, "ready", ["pending", "brewing"]);
    }
  }

  private async evaluateAndBroadcastOrderStatus(orderId: string): Promise<void> {
    await this.evaluateOrderStatus(orderId);
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

      const linkedUnits = Array.from(this.brewUnits.values()).filter((u) =>
        order.items.some((item) => item.id === u.orderItemId),
      );
      for (const u of linkedUnits) {
        this.brewUnits.delete(u.id);
        this.broadcast({ type: "BREW_UNIT_DELETED", brewUnitId: u.id });
      }
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
