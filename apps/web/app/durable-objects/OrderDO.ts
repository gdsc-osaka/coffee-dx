import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { brewUnits, menuItems, orderItems, orders } from "../../db/schema";
import {
  consumeQueue,
  refillQueue,
  trimQueueAfterOrderCancel,
  type QueueEntry,
  type QueueMenus,
} from "../features/brew-queue/queue";
import { createDb } from "../lib/db";
import { getJstNowString } from "../lib/datetime";
import { getBusinessDate } from "../lib/order-do";

/** 次枠キューと対象メニュー ID を保存する DO storage のキー（DO は業務日ごとなので日付は含めない） */
const QUEUE_STORAGE_KEY = "brewQueue";
const QUEUE_MENUS_STORAGE_KEY = "brewQueueMenuIds";

type OrderStatus = "pending" | "brewing" | "ready" | "completed" | "cancelled";

type OrderItemData = {
  id: string;
  orderId: string;
  menuItemId: string;
  /** 旧イベントの payload では未指定。 */
  unitPriceAtOrder?: number;
  quantity: number;
  /** 旧イベントの payload では未指定のため、未指定は brew として扱う。 */
  fulfillmentTypeAtOrder?: "brew" | "direct";
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
  /** ドリップ係が指定したタイマー秒数。NULL はタイマー未設定。 */
  targetDurationSec: number | null;
  /** タイマー Start 時刻 (ISO 8601)。NULL はタイマー未開始。 */
  timerStartedAt: string | null;
  /** 物理ドリッパー（レーン枠）の位置 (0 始まり)。全端末で同じ表示にするため永続化 */
  laneIndex: number;
  businessDate: string;
  createdAt: string;
  updatedAt: string;
};

type ServerMessage =
  | { type: "SNAPSHOT"; orders: OrderData[]; brewUnits: BrewUnitData[]; queue: QueueEntry[] }
  | { type: "QUEUE_UPDATED"; queue: QueueEntry[] }
  | { type: "ORDER_CREATED"; order: OrderData }
  | { type: "ORDER_UPDATED"; orderId: string; status: OrderStatus }
  | { type: "BREW_UNITS_CREATED"; brewUnits: BrewUnitData[] }
  | { type: "BREW_UNIT_UPDATED"; brewUnit: BrewUnitData }
  | { type: "BREW_UNIT_DELETED"; brewUnitId: string }
  | { type: "pong" };

/**
 * targetDurationSec の正規化。
 * NaN / 非数 / 1 秒未満（負数や小数で 0 に丸まる値を含む）はすべて null にする。
 * brew-start と brew-set-timer の両経路で同じ判定を使う。
 */
function normalizeTargetDurationSec(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const seconds = Math.floor(value);
  return seconds >= 1 ? seconds : null;
}

export class OrderDurableObject implements DurableObject {
  private readonly orders = new Map<string, OrderData>();
  private readonly brewUnits = new Map<string, BrewUnitData>();
  private readonly sessions = new Map<
    WebSocket,
    { deadline: number; timer: ReturnType<typeof setTimeout> }
  >();
  /** 次枠キュー（docs/design/drip-suggestion.md）。全端末で同じ内容を表示する */
  private queue: QueueEntry[] = [];
  /** 対象メニュー ID。一度決めたら営業中は変えない。メニュー未登録の間は null */
  private queueMenus: QueueMenus | null = null;
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
      const deadline = Number(request.headers.get("x-auth-deadline"));
      if (
        !request.headers.get("x-auth-user-id") ||
        !request.headers.get("x-auth-session-id") ||
        !Number.isSafeInteger(deadline) ||
        deadline <= Date.now() ||
        deadline > Date.now() + 300_000
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      return this.handleWebSocket(deadline);
    }

    await this.initialize();

    // POST /do/new-order
    if (request.method === "POST" && url.pathname === "/do/new-order") {
      const order = (await request.json()) as OrderData;
      await this.newOrder(order);
      return new Response(null, { status: 204 });
    }

    const mobileOrderMatch = url.pathname.match(/^\/do\/mobile-orders\/([^/]+)\/(pay|cancel)$/);
    if (request.method === "POST" && mobileOrderMatch) {
      const [, requestId, action] = mobileOrderMatch;
      if (action === "pay") return this.handleMobileOrderPayment(requestId);
      return this.handleMobileOrderCancellation(requestId);
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

    // POST /do/brew-units/batch/:batchId/timer  →  タイマー開始 / 再設定
    const timerMatch = url.pathname.match(/^\/do\/brew-units\/batch\/([^/]+)\/timer$/);
    if (request.method === "POST" && timerMatch) {
      return this.handleBatchSetTimer(timerMatch[1], request);
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
          return this.transitionStatus(orderId, "cancelled", ["pending", "brewing", "ready"]);
        case "close":
          // 過去日のやり残し注文は、抽出の紐付けをせずに提供したものも完了にできるよう
          // pending/brewing からの完了を許す。当日は受け取り可能 (ready) な注文だけ（DX-49）。
          return this.transitionStatus(
            orderId,
            "completed",
            this.isPastBusinessDate() ? ["pending", "brewing", "ready"] : ["ready"],
          );
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
        // brew_units 側と同様に business_date でも絞る。これが無いと別 event の
        // pending/brewing/ready 注文を取り込み、当日に紐付き brew_unit が無いまま
        // 「未着手なのに ready」表示になる事故を起こす（DX-49）。
        const activeOrders = await db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.businessDate, eventId),
              inArray(orders.status, ["pending", "brewing", "ready"]),
            ),
          );

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
            id: item.id,
            orderId: item.orderId,
            menuItemId: item.menuItemId,
            unitPriceAtOrder: item.unitPriceAtOrder,
            quantity: item.quantity,
            fulfillmentTypeAtOrder: item.fulfillmentTypeAtOrder === "direct" ? "direct" : "brew",
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
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
            timerStartedAt: u.timerStartedAt,
            laneIndex: u.laneIndex,
            businessDate: u.businessDate,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          });
        }

        // --- 次枠キュー ---
        this.queue = (await this.state.storage.get<QueueEntry[]>(QUEUE_STORAGE_KEY)) ?? [];
        await this.ensureQueueMenus();

        this.initialized = true;
      });
    }

    return this.initPromise;
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  private async handleWebSocket(deadline: number): Promise<Response> {
    await this.initialize();
    if (deadline <= Date.now()) return new Response("Unauthorized", { status: 401 });

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const closeExpired = () => {
      this.removeSession(server);
      try {
        server.close(4001, "Authentication expired");
      } catch {
        // Already closed.
      }
    };
    const timer = setTimeout(closeExpired, Math.max(0, deadline - Date.now()));
    this.sessions.set(server, { deadline, timer });
    server.send(
      JSON.stringify({ type: "auth-deadline", authDeadline: deadline, serverTime: Date.now() }),
    );

    const snapshotOrders = Array.from(this.orders.values()).filter(
      (o) => o.status !== "completed" && o.status !== "cancelled",
    );
    const snapshotBrewUnits = Array.from(this.brewUnits.values());
    server.send(
      JSON.stringify({
        type: "SNAPSHOT",
        orders: snapshotOrders,
        brewUnits: snapshotBrewUnits,
        queue: this.queue,
      } satisfies ServerMessage),
    );

    server.addEventListener("close", () => this.removeSession(server));
    server.addEventListener("error", () => this.removeSession(server));

    // クライアントからのアプリケーション層 ping に pong で応答する。
    // Cloudflare の WebSocket アイドルタイムアウト（約 100 秒）や NAT 再起動などで
    // TCP が「半開き」になった際、クライアント側が onclose を受け取れないままに
    // なる現象を防ぐため、フレーム往復をクライアント主導で確認させる。
    server.addEventListener("message", (event: MessageEvent) => {
      if (Date.now() >= deadline) {
        closeExpired();
        return;
      }
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data) as { type?: unknown };
        if (msg && msg.type === "ping") {
          server.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // 不正な JSON / 想定外メッセージは無視
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------------------
  // 注文作成
  // ---------------------------------------------------------------------------

  private async getMobileOrderRequest(requestId: string): Promise<{
    id: string;
    businessDate: string;
    orderNumber: number;
    status: "awaiting_payment" | "paid" | "cancelled";
    acceptedOrderId: string | null;
  } | null> {
    return this.env.DB.prepare(
      `SELECT id, business_date AS businessDate, order_number AS orderNumber,
              status, accepted_order_id AS acceptedOrderId
         FROM mobile_order_requests
        WHERE id = ?`,
    )
      .bind(requestId)
      .first<{
        id: string;
        businessDate: string;
        orderNumber: number;
        status: "awaiting_payment" | "paid" | "cancelled";
        acceptedOrderId: string | null;
      }>();
  }

  private async loadOrderData(orderId: string): Promise<OrderData | null> {
    const db = createDb(this.env.DB);
    const order = await db.select().from(orders).where(eq(orders.id, orderId)).get();
    if (!order) return null;

    const dbItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const menuIds = [...new Set(dbItems.map((item) => item.menuItemId))];
    const menuRecords =
      menuIds.length > 0
        ? await db
            .select({ id: menuItems.id, name: menuItems.name })
            .from(menuItems)
            .where(inArray(menuItems.id, menuIds))
        : [];
    const menuNames = new Map(menuRecords.map((menu) => [menu.id, menu.name]));

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status as OrderStatus,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: dbItems.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        menuItemId: item.menuItemId,
        unitPriceAtOrder: item.unitPriceAtOrder,
        quantity: item.quantity,
        fulfillmentTypeAtOrder: item.fulfillmentTypeAtOrder === "direct" ? "direct" : "brew",
        name: menuNames.get(item.menuItemId),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };
  }

  private async registerOrderIfMissing(order: OrderData): Promise<void> {
    const existing = this.orders.get(order.id);
    if (existing) {
      await this.autoAssignReadyUnits(existing);
      await this.refillBrewQueue();
      return;
    }
    this.orders.set(order.id, order);
    this.broadcast({ type: "ORDER_CREATED", order });
    await this.autoAssignReadyUnits(order);
    await this.refillBrewQueue();
  }

  private async handleMobileOrderPayment(requestId: string): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      const request = await this.getMobileOrderRequest(requestId);
      if (!request) return new Response("Mobile order request not found", { status: 404 });
      // 現状 eventId は呼び出し側が request.businessDate から渡すため常に一致する（下の D1 条件も同様）。マルチテナント化を見越して残す。
      if (request.businessDate !== this.eventId) {
        return new Response("Payment is only available for the current business date", {
          status: 409,
        });
      }
      if (request.status === "cancelled") {
        return new Response("Cancelled mobile order cannot be paid", { status: 409 });
      }

      if (request.status === "paid") {
        if (!request.acceptedOrderId) {
          return new Response("Paid mobile order has no accepted order", { status: 500 });
        }
        const order = await this.loadOrderData(request.acceptedOrderId);
        if (!order) return new Response("Accepted order not found", { status: 500 });
        if (["pending", "brewing", "ready"].includes(order.status)) {
          await this.registerOrderIfMissing(order);
        }
        return Response.json({ status: "already_paid", orderId: order.id });
      }

      const itemRows = await this.env.DB.prepare(
        `SELECT id, menu_item_id AS menuItemId, quantity
           FROM mobile_order_request_items
          WHERE request_id = ?
          ORDER BY rowid`,
      )
        .bind(requestId)
        .all<{ id: string; menuItemId: string; quantity: number }>();
      if (itemRows.results.length === 0) {
        return new Response("Mobile order has no items", { status: 409 });
      }

      // D1が確定したのに応答だけ失われた場合、同じIDで再送するとorder_itemsの主キーが衝突する。
      // 再試行ごとにIDを作り直し、確定済みなら全文0行で終わらせて下の再読込で結果を確認する。
      const buildPaymentStatements = (): D1PreparedStatement[] => {
        const now = getJstNowString();
        const orderId = crypto.randomUUID();
        const orderItemIds = itemRows.results.map(() => crypto.randomUUID());
        const statements: D1PreparedStatement[] = [
          // direct 商品だけの注文は会計時に受け渡すため、抽出を待たず completed で作成する。
          this.env.DB.prepare(
            `INSERT INTO orders
               (id, business_date, order_number, status, is_free, mobile_request_id, created_at, updated_at)
             SELECT ?, ?, ?,
                    CASE WHEN EXISTS (
                      SELECT 1
                        FROM mobile_order_request_items AS request_item
                        LEFT JOIN menu_items AS menu ON menu.id = request_item.menu_item_id
                       WHERE request_item.request_id = ?
                         AND COALESCE(menu.fulfillment_type, 'brew') <> 'direct'
                    ) THEN 'pending' ELSE 'completed' END,
                    0, ?, ?, ?
               FROM mobile_order_requests
              WHERE id = ? AND status = 'awaiting_payment' AND accepted_order_id IS NULL
                AND business_date = ?
                AND EXISTS (
                  SELECT 1 FROM mobile_order_request_items WHERE request_id = ?
                )`,
          ).bind(
            orderId,
            request.businessDate,
            request.orderNumber,
            requestId,
            requestId,
            now,
            now,
            requestId,
            this.eventId,
            requestId,
          ),
        ];

        for (let i = 0; i < itemRows.results.length; i++) {
          const item = itemRows.results[i];
          statements.push(
            this.env.DB.prepare(
              // 単価は受付時に確定した値を、提供種別は会計時点の商品マスタの値を明細に固定する。
              `INSERT INTO order_items
                 (id, order_id, menu_item_id, unit_price_at_order, fulfillment_type_at_order,
                  quantity, created_at, updated_at)
               SELECT ?, ?, request_item.menu_item_id, request_item.unit_price_at_order,
                      COALESCE(menu.fulfillment_type, 'brew'), request_item.quantity, ?, ?
                 FROM mobile_order_request_items AS request_item
                 LEFT JOIN menu_items AS menu ON menu.id = request_item.menu_item_id
                WHERE request_item.id = ? AND request_item.request_id = ?
                  AND EXISTS (
                    SELECT 1 FROM orders WHERE id = ? AND mobile_request_id = ?
                  )`,
            ).bind(orderItemIds[i], orderId, now, now, item.id, requestId, orderId, requestId),
          );
        }

        statements.push(
          this.env.DB.prepare(
            `UPDATE mobile_order_requests
                SET status = 'paid', paid_at = ?, accepted_order_id = ?, updated_at = ?
              WHERE id = ? AND status = 'awaiting_payment' AND business_date = ?
                AND accepted_order_id IS NULL
                AND EXISTS (
                  SELECT 1 FROM orders WHERE id = ? AND mobile_request_id = ?
                )`,
          ).bind(now, orderId, now, requestId, this.eventId, orderId, requestId),
        );
        return statements;
      };

      await this.writeWithRetry(() => this.env.DB.batch(buildPaymentStatements()));

      const updatedRequest = await this.getMobileOrderRequest(requestId);
      if (!updatedRequest || updatedRequest.status !== "paid" || !updatedRequest.acceptedOrderId) {
        if (updatedRequest?.status === "cancelled") {
          return new Response("Cancelled mobile order cannot be paid", { status: 409 });
        }
        return new Response("Mobile order payment could not be completed", { status: 409 });
      }

      const order = await this.loadOrderData(updatedRequest.acceptedOrderId);
      if (!order) return new Response("Accepted order not found", { status: 500 });
      if (["pending", "brewing", "ready"].includes(order.status)) {
        await this.registerOrderIfMissing(order);
      }
      return Response.json({ status: "paid", orderId: order.id });
    });
  }

  private async handleMobileOrderCancellation(requestId: string): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      const request = await this.getMobileOrderRequest(requestId);
      if (!request) return new Response("Mobile order request not found", { status: 404 });
      // 現状 eventId は呼び出し側が request.businessDate から渡すため常に一致する。マルチテナント化を見越して残す。
      if (request.businessDate !== this.eventId) {
        return new Response("Order belongs to another business date", { status: 409 });
      }
      if (request.status === "paid") {
        return new Response("Paid mobile order cannot be cancelled here", { status: 409 });
      }
      if (request.status === "cancelled") {
        return Response.json({ status: "already_cancelled" });
      }

      const result = await this.writeWithRetry(() =>
        this.env.DB.prepare(
          `UPDATE mobile_order_requests
              SET status = 'cancelled', updated_at = ?
            WHERE id = ? AND status = 'awaiting_payment'`,
        )
          .bind(getJstNowString(), requestId)
          .run(),
      );
      if (result.meta?.changes === 0) {
        const updated = await this.getMobileOrderRequest(requestId);
        if (updated?.status === "cancelled") return Response.json({ status: "already_cancelled" });
        if (updated?.status === "paid") {
          return new Response("Paid mobile order cannot be cancelled here", { status: 409 });
        }
        return new Response("Mobile order cancellation conflicted", { status: 409 });
      }
      return Response.json({ status: "cancelled" });
    });
  }

  private async newOrder(order: OrderData): Promise<void> {
    // handleBatchComplete と同じ ready 未紐付けプールを取り合うため、
    // setTimeout バックオフ越しの interleave を防ぐ目的で全体を直列化する。
    await this.state.blockConcurrencyWhile(async () => {
      this.orders.set(order.id, order);
      this.broadcast({ type: "ORDER_CREATED", order });
      await this.autoAssignReadyUnits(order);

      await this.refillBrewQueue();
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
      if (item.fulfillmentTypeAtOrder === "direct") continue;

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
    // D1 書き込み中の await をまたいで別の抽出開始が割り込むと、同じキュー状態を
    // 基準に消費しうる。D1 更新からキュー保存までを営業日単位で直列化する。
    return this.state.blockConcurrencyWhile(async () => {
      const body = (await request.json()) as {
        menuItemId: string;
        count: number;
        laneIndex?: number;
        targetDurationSec?: number | null;
      };
      const { menuItemId, count } = body;
      const targetDurationSec = normalizeTargetDurationSec(body.targetDurationSec);
      // laneIndex は 0 以上の整数。負値や未指定は 0 (レーン 1) とみなす。
      const laneIndex =
        typeof body.laneIndex === "number" && Number.isFinite(body.laneIndex) && body.laneIndex >= 0
          ? Math.floor(body.laneIndex)
          : 0;

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
      // targetDurationSec を渡された場合のみ timerStartedAt も同時に開始する。
      // タイマーは抽出開始と独立に後付けで設定することも可能（/timer エンドポイント）。
      const initialTimerStartedAt = targetDurationSec === null ? null : now;
      const newUnits: BrewUnitData[] = Array.from({ length: count }, () => ({
        id: crypto.randomUUID(),
        batchId,
        menuItemId,
        menuItemName: menuRecord.name,
        orderItemId: null,
        status: "brewing" as const,
        targetDurationSec,
        timerStartedAt: initialTimerStartedAt,
        laneIndex,
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
            timerStartedAt: u.timerStartedAt,
            laneIndex: u.laneIndex,
            businessDate: u.businessDate,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          })),
        ),
      );

      for (const u of newUnits) this.brewUnits.set(u.id, u);
      this.broadcast({ type: "BREW_UNITS_CREATED", brewUnits: newUnits });

      // 次枠キュー: 開始した内容に対応するエントリーを消費してから補充する
      await this.refillBrewQueue((queue) => consumeQueue(queue, { menuItemId, count }));

      return new Response(null, { status: 204 });
    });
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: バッチ完了 + 先着順紐付け（競合防止: DO のシングルスレッドを活用）
  // ---------------------------------------------------------------------------

  private async handleBatchComplete(batchId: string): Promise<Response> {
    const eventId = this.eventId;
    if (!eventId) return new Response("Missing eventId context", { status: 400 });

    // 割り当て計画中の interleave は blockConcurrencyWhile で防ぎ、D1 上の
    // brewing→ready・注文への紐付け・orders.ready は 1 回の batch transaction で確定する。
    // 同じ batchId の再送は、既に ready でも再評価して 200 を返す（冪等）。
    return this.state.blockConcurrencyWhile(async () => {
      const now = new Date().toISOString();

      const allBatchUnits = [...this.brewUnits.values()].filter((u) => u.batchId === batchId);
      if (allBatchUnits.length === 0) return new Response("Batch not found", { status: 404 });
      const completingUnits = allBatchUnits.filter((u) => u.status === "brewing");
      const completingIds = new Set(completingUnits.map((u) => u.id));

      // transaction 成功後に ready になる今回のバッチと、既存の余剰をまとめて割り当てる。
      const readyUnassigned = [...this.brewUnits.values()].filter(
        (u) => (u.status === "ready" || completingIds.has(u.id)) && u.orderItemId === null,
      );
      const poolByMenu = new Map<string, BrewUnitData[]>();
      for (const u of readyUnassigned) {
        if (!poolByMenu.has(u.menuItemId)) poolByMenu.set(u.menuItemId, []);
        poolByMenu.get(u.menuItemId)!.push(u);
      }
      for (const pool of poolByMenu.values()) {
        pool.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      }

      const activeOrders = [...this.orders.values()]
        .filter((o) => o.status === "pending" || o.status === "brewing")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const assignments: Array<{ unit: BrewUnitData; orderItemId: string }> = [];
      const plannedByItem = new Map<string, number>();

      for (const order of activeOrders) {
        for (const item of order.items) {
          if (item.fulfillmentTypeAtOrder === "direct") continue;

          const pool = poolByMenu.get(item.menuItemId);
          if (!pool || pool.length === 0) continue;

          const alreadyLinked = [...this.brewUnits.values()].filter(
            (u) => u.orderItemId === item.id && u.status === "ready",
          ).length;
          const needed = item.quantity - alreadyLinked - (plannedByItem.get(item.id) ?? 0);
          if (needed <= 0) continue;

          const toAssign = pool.splice(0, needed);
          for (const unit of toAssign) {
            assignments.push({ unit, orderItemId: item.id });
            plannedByItem.set(item.id, (plannedByItem.get(item.id) ?? 0) + 1);
          }
        }
      }

      // 既存の紐付き ready と今回の割り当てを合わせ、ready にできる注文を先に決める。
      // 再送時も全 active order を評価することで、以前の部分成功状態を自己修復できる。
      const readyOrders = activeOrders.filter((order) =>
        order.items.every((item) => {
          if (item.fulfillmentTypeAtOrder === "direct") return true;

          const linked = [...this.brewUnits.values()].filter(
            (u) => u.orderItemId === item.id && u.status === "ready",
          ).length;
          return linked + (plannedByItem.get(item.id) ?? 0) >= item.quantity;
        }),
      );

      const statements: D1PreparedStatement[] = [];
      if (completingUnits.length > 0) {
        statements.push(
          this.env.DB.prepare(
            "UPDATE brew_units SET status = 'ready', updated_at = ? WHERE business_date = ? AND batch_id = ? AND status = 'brewing'",
          ).bind(now, eventId, batchId),
        );
      }
      for (const { unit, orderItemId } of assignments) {
        statements.push(
          this.env.DB.prepare(
            "UPDATE brew_units SET order_item_id = ?, updated_at = ? WHERE id = ? AND order_item_id IS NULL",
          ).bind(orderItemId, now, unit.id),
        );
      }
      for (const order of readyOrders) {
        statements.push(
          this.env.DB.prepare(
            "UPDATE orders SET status = 'ready', updated_at = ? WHERE id = ? AND status IN ('pending', 'brewing')",
          ).bind(now, order.id),
        );
      }

      // D1 batch はいずれかの statement が失敗すれば全体が rollback される。
      // 成功するまで DO メモリと WebSocket には一切反映しない。
      if (statements.length > 0) {
        await this.writeWithRetry(() => this.env.DB.batch(statements));
      }

      for (const unit of completingUnits) {
        unit.status = "ready";
        unit.updatedAt = now;
        this.brewUnits.set(unit.id, unit);
      }
      for (const { unit, orderItemId } of assignments) {
        unit.orderItemId = orderItemId;
        unit.updatedAt = now;
        this.brewUnits.set(unit.id, unit);
      }

      // ORDER_UPDATED を BREW_UNIT_UPDATED より先に送り、仮想 ready とDB状態の窓を作らない。
      for (const order of readyOrders) {
        order.status = "ready";
        order.updatedAt = now;
        this.broadcast({ type: "ORDER_UPDATED", orderId: order.id, status: "ready" });
      }

      // 再送時にもバッチの確定状態を再通知できるよう、当該バッチはすべて対象にする。
      const updatedUnitIds = new Set(allBatchUnits.map((u) => u.id));
      for (const { unit } of assignments) updatedUnitIds.add(unit.id);
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

      // 取り消した杯は未対応に戻るので補充する
      await this.refillBrewQueue();

      return new Response(null, { status: 200 });
    });
  }

  // ---------------------------------------------------------------------------
  // BrewUnit: タイマー設定 / 再設定（バッチ単位）
  // 抽出開始 (createdAt) とは独立に、タイマーを後付けで開始したり、終了後に再開
  // したりする用途。targetDurationSec=null を渡せばタイマー解除（クリア）。
  // ---------------------------------------------------------------------------

  private async handleBatchSetTimer(batchId: string, request: Request): Promise<Response> {
    const body = (await request.json()) as { targetDurationSec?: number | null };
    const targetDurationSec = normalizeTargetDurationSec(body.targetDurationSec);
    const now = new Date().toISOString();
    const timerStartedAt = targetDurationSec === null ? null : now;

    return this.state.blockConcurrencyWhile(async () => {
      const targetUnits = [...this.brewUnits.values()].filter(
        (u) => u.batchId === batchId && u.status === "brewing",
      );
      if (targetUnits.length === 0) {
        return new Response("Batch not found or not active", { status: 404 });
      }

      const db = createDb(this.env.DB);
      await this.writeWithRetry(() =>
        db
          .update(brewUnits)
          .set({ targetDurationSec, timerStartedAt, updatedAt: now })
          .where(and(eq(brewUnits.batchId, batchId), eq(brewUnits.status, "brewing"))),
      );

      for (const u of targetUnits) {
        u.targetDurationSec = targetDurationSec;
        u.timerStartedAt = timerStartedAt;
        u.updatedAt = now;
        this.brewUnits.set(u.id, u);
        this.broadcast({ type: "BREW_UNIT_UPDATED", brewUnit: { ...u } });
      }

      return new Response(null, { status: 204 });
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
      (item) =>
        item.fulfillmentTypeAtOrder === "direct" ||
        linkedReady.filter((u) => u.orderItemId === item.id).length >= item.quantity,
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

  /** この DO の営業日が今日 (JST) より前か。eventId は YYYY-MM-DD なので文字列比較で判定できる。 */
  private isPastBusinessDate(): boolean {
    return this.eventId !== null && this.eventId < getBusinessDate();
  }

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

    // 次枠キュー: 注文の取消で余った対応予定を減らしてから補充する
    if (targetStatus === "cancelled") {
      await this.refillBrewQueue((queue, menus) =>
        trimQueueAfterOrderCancel(
          queue,
          [...this.orders.values()],
          [...this.brewUnits.values()],
          menus,
        ),
      );
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

  // ---------------------------------------------------------------------------
  // 次枠キュー
  // ---------------------------------------------------------------------------

  /**
   * 対象メニューを決める。保存済みならそれを使い、なければ提供中の全メニューを
   * 登録日時順（同時刻なら id 順）で取得して保存する。一度決まったら営業中は変えない。
   */
  private async ensureQueueMenus(): Promise<void> {
    if (this.queueMenus) return;

    const stored = await this.state.storage.get<QueueMenus>(QUEUE_MENUS_STORAGE_KEY);
    if (stored) {
      this.queueMenus = stored;
      return;
    }

    const db = createDb(this.env.DB);
    const menus = await db
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.isAvailable, 1), eq(menuItems.fulfillmentType, "brew")))
      .orderBy(asc(menuItems.createdAt), asc(menuItems.id));
    if (menus.length === 0) return;

    this.queueMenus = menus.map((menu) => menu.id);
    await this.state.storage.put(QUEUE_MENUS_STORAGE_KEY, this.queueMenus);
  }

  /**
   * 補充して保存・送信する。before を渡すと、先にキューへ適用（消費・削減）してから補充する。
   * this.queue を読んでから代入するまでの間に await を挟まないこと（同時操作での取りこぼし防止）。
   */
  private async refillBrewQueue(
    before: (queue: QueueEntry[], menus: QueueMenus) => QueueEntry[] = (queue) => queue,
  ): Promise<void> {
    await this.ensureQueueMenus();
    const menus = this.queueMenus;
    if (!menus) return;

    const next = refillQueue({
      queue: before(this.queue, menus),
      orders: [...this.orders.values()],
      brewUnits: [...this.brewUnits.values()],
      menus,
      now: Date.now(),
    });

    if (JSON.stringify(next) === JSON.stringify(this.queue)) return;
    await this.state.storage.put(QUEUE_STORAGE_KEY, next);
    this.queue = next;
    this.broadcast({ type: "QUEUE_UPDATED", queue: next });
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const [session, metadata] of this.sessions) {
      if (Date.now() >= metadata.deadline) {
        this.removeSession(session);
        session.close(4001, "Authentication expired");
        continue;
      }
      try {
        session.send(payload);
      } catch {
        this.removeSession(session);
      }
    }
  }

  private removeSession(session: WebSocket): void {
    const metadata = this.sessions.get(session);
    if (!metadata) return;
    clearTimeout(metadata.timer);
    this.sessions.delete(session);
  }
}
