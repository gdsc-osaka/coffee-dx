import { getAvailableMenuItems } from "../menu/queries";
import { createDb } from "../../lib/db";
import { getBusinessDate } from "../../lib/order-do";
import { getJstNowString } from "../../lib/datetime";
import {
  mobileIdempotencyKeySchema,
  mobileOrderItemsSchema,
  mobileStoreTokenSchema,
  type MobileOrderItemInput,
} from "./schemas";

export type { MobileOrderItemInput } from "./schemas";

type MobileEnv = Env & { MOBILE_ORDER_STORE_TOKEN?: string };

export type MobileOrderItemSnapshot = MobileOrderItemInput & {
  name: string;
  price: number;
};

export type MobileOrderRequestResult = {
  id: string;
  publicToken: string;
  businessDate: string;
  orderNumber: number;
  status: "awaiting_payment" | "paid" | "cancelled";
  /** 支払後に作成された通常注文の状態。会計前・取消済みは null。 */
  orderStatus: "pending" | "brewing" | "ready" | "completed" | "cancelled" | null;
  createdAt: string;
  items: MobileOrderItemSnapshot[];
};

export type MobileOrderStatus = Pick<MobileOrderRequestResult, "status" | "orderStatus">;

type StoredRequest = {
  id: string;
  store_token: string;
  business_date: string;
  order_number: number;
  status: MobileOrderRequestResult["status"];
  public_token: string;
  accepted_order_id: string | null;
  created_at: string;
};

type StoredRequestItem = {
  menu_item_id: string;
  item_name_at_order: string;
  unit_price_at_order: number;
  quantity: number;
};

export class MobileOrderClosedError extends Error {
  constructor() {
    super("モバイルオーダーは現在受け付けていません。");
    this.name = "MobileOrderClosedError";
  }
}

export class MobileOrderConflictError extends Error {
  constructor() {
    super("同じ受付キーで異なる注文内容は送信できません。");
    this.name = "MobileOrderConflictError";
  }
}

export class MobileOrderItemUnavailableError extends Error {
  constructor() {
    super("販売中でない商品が含まれています。内容を修正してください。");
    this.name = "MobileOrderItemUnavailableError";
  }
}

export function getConfiguredMobileStoreToken(env: Env): string {
  const token = (env as MobileEnv).MOBILE_ORDER_STORE_TOKEN;
  const result = mobileStoreTokenSchema.safeParse(token);
  if (!result.success) {
    throw new Error("MOBILE_ORDER_STORE_TOKEN is not configured with a secure token");
  }
  return result.data;
}

export function isValidMobileStoreToken(env: Env, storeToken: unknown): storeToken is string {
  const configured = (env as MobileEnv).MOBILE_ORDER_STORE_TOKEN;
  return (
    mobileStoreTokenSchema.safeParse(configured).success &&
    mobileStoreTokenSchema.safeParse(storeToken).success &&
    storeToken === configured
  );
}

export async function getMobileOrderAcceptance(
  d1: D1Database,
  storeToken: string,
  businessDate = getBusinessDate(),
): Promise<boolean> {
  const row = await d1
    .prepare(
      `SELECT is_accepting AS isAccepting
       FROM mobile_order_acceptance
       WHERE store_token = ? AND business_date = ?`,
    )
    .bind(storeToken, businessDate)
    .first<{ isAccepting: number }>();
  return row?.isAccepting === 1;
}

export async function setMobileOrderAcceptance(
  d1: D1Database,
  storeToken: string,
  isAccepting: boolean,
  businessDate = getBusinessDate(),
): Promise<void> {
  const now = getJstNowString();
  await d1
    .prepare(
      `INSERT INTO mobile_order_acceptance
         (id, store_token, business_date, is_accepting, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(store_token, business_date) DO UPDATE SET
         is_accepting = excluded.is_accepting,
         updated_at = excluded.updated_at`,
    )
    .bind(`${storeToken}:${businessDate}`, storeToken, businessDate, isAccepting ? 1 : 0, now)
    .run();
}

async function getRequestByIdempotencyKey(
  d1: D1Database,
  storeToken: string,
  idempotencyKey: string,
): Promise<MobileOrderRequestResult | null> {
  const request = await d1
    .prepare(
      `SELECT id, store_token, business_date, order_number, status, public_token,
              accepted_order_id, created_at
       FROM mobile_order_requests
       WHERE store_token = ? AND idempotency_key = ?`,
    )
    .bind(storeToken, idempotencyKey)
    .first<StoredRequest>();
  if (!request) return null;

  return getRequestResult(d1, request);
}

export async function getMobileOrderByPublicToken(
  d1: D1Database,
  publicToken: string,
): Promise<MobileOrderRequestResult | null> {
  const request = await d1
    .prepare(
      `SELECT id, store_token, business_date, order_number, status, public_token,
              accepted_order_id, created_at
       FROM mobile_order_requests
       WHERE public_token = ?`,
    )
    .bind(publicToken)
    .first<StoredRequest>();
  if (!request) return null;
  return getRequestResult(d1, request);
}

export async function getMobileOrderStatusByPublicToken(
  d1: D1Database,
  publicToken: string,
): Promise<MobileOrderStatus | null> {
  const row = await d1
    .prepare(
      `SELECT request.status, accepted.status AS orderStatus
         FROM mobile_order_requests AS request
         LEFT JOIN orders AS accepted
           ON accepted.id = request.accepted_order_id
          AND accepted.mobile_request_id = request.id
        WHERE request.public_token = ?`,
    )
    .bind(publicToken)
    .first<MobileOrderStatus>();
  return row ?? null;
}

async function getRequestResult(
  d1: D1Database,
  request: StoredRequest,
): Promise<MobileOrderRequestResult> {
  const { results } = await d1
    .prepare(
      `SELECT menu_item_id, item_name_at_order, unit_price_at_order, quantity
       FROM mobile_order_request_items
       WHERE request_id = ?
       ORDER BY id`,
    )
    .bind(request.id)
    .all<StoredRequestItem>();

  const acceptedOrder = request.accepted_order_id
    ? await d1
        .prepare(
          `SELECT status
             FROM orders
            WHERE id = ? AND mobile_request_id = ?`,
        )
        .bind(request.accepted_order_id, request.id)
        .first<{
          status: MobileOrderRequestResult["orderStatus"];
        }>()
    : null;

  return {
    id: request.id,
    publicToken: request.public_token,
    businessDate: request.business_date,
    orderNumber: request.order_number,
    status: request.status,
    orderStatus: acceptedOrder?.status ?? null,
    createdAt: request.created_at,
    items: results.map((item) => ({
      menuItemId: item.menu_item_id,
      name: item.item_name_at_order,
      price: item.unit_price_at_order,
      quantity: item.quantity,
    })),
  };
}

function sameCart(a: MobileOrderItemInput[], b: MobileOrderItemSnapshot[]): boolean {
  const left = normalizeCart(a);
  const right = normalizeCart(b);
  const rightByMenuId = new Map(right.map((item) => [item.menuItemId, item.quantity]));
  return (
    left.length === right.length &&
    left.every((item) => rightByMenuId.get(item.menuItemId) === item.quantity)
  );
}

function normalizeCart(items: MobileOrderItemInput[]): MobileOrderItemInput[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.menuItemId, (quantities.get(item.menuItemId) ?? 0) + item.quantity);
  }
  return [...quantities.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

export async function createMobileOrderRequest(
  d1: D1Database,
  env: Env,
  storeToken: string,
  requestedItems: MobileOrderItemInput[],
  idempotencyKey: string,
  businessDate = getBusinessDate(),
): Promise<MobileOrderRequestResult> {
  if (!isValidMobileStoreToken(env, storeToken)) {
    throw new Response("店舗が見つかりません", { status: 404 });
  }
  const idempotencyResult = mobileIdempotencyKeySchema.safeParse(idempotencyKey);
  if (!idempotencyResult.success) {
    throw new Error("受付キーが不正です。");
  }

  const itemsResult = mobileOrderItemsSchema.safeParse(requestedItems);
  if (!itemsResult.success) {
    throw new Error(itemsResult.error.issues[0]?.message ?? "注文内容が不正です。");
  }
  const validItems = itemsResult.data;

  const existing = await getRequestByIdempotencyKey(d1, storeToken, idempotencyKey);
  if (existing) {
    if (!sameCart(validItems, existing.items)) throw new MobileOrderConflictError();
    return existing;
  }

  const items = normalizeCart(validItems);

  const db = createDb(d1);
  const menu = await getAvailableMenuItems(db);
  const menuById = new Map(menu.map((item) => [item.id, item]));
  const snapshots: MobileOrderItemSnapshot[] = [];
  for (const item of items) {
    const menuItem = menuById.get(item.menuItemId);
    if (!menuItem) throw new MobileOrderItemUnavailableError();
    snapshots.push({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      name: menuItem.name,
      price: menuItem.price,
    });
  }

  const id = crypto.randomUUID();
  const publicToken = crypto.randomUUID().replaceAll("-", "");
  const now = getJstNowString();

  // D1 batch は同一トランザクションで順番に実行される。
  // 受付中でない場合はカウンタ更新もリクエスト作成も0件になるため、
  // 停止中の注文が番号を消費しない。
  const statements = [
    d1
      .prepare(
        `INSERT INTO order_number_counters (business_date, next_number, created_at, updated_at)
         SELECT ?, 2, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM mobile_order_acceptance
           WHERE store_token = ? AND business_date = ? AND is_accepting = 1
         )
         ON CONFLICT(business_date) DO UPDATE SET
           next_number = order_number_counters.next_number + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(businessDate, now, now, storeToken, businessDate),
    d1
      .prepare(
        `INSERT INTO mobile_order_requests
           (id, store_token, business_date, order_number, status, idempotency_key, public_token, created_at, updated_at)
         SELECT ?, ?, ?, next_number - 1, 'awaiting_payment', ?, ?, ?, ?
         FROM order_number_counters
         WHERE business_date = ?
           AND EXISTS (
             SELECT 1 FROM mobile_order_acceptance
             WHERE store_token = ? AND business_date = ? AND is_accepting = 1
           )`,
      )
      .bind(
        id,
        storeToken,
        businessDate,
        idempotencyKey,
        publicToken,
        now,
        now,
        businessDate,
        storeToken,
        businessDate,
      ),
    ...snapshots.map((item) =>
      d1
        .prepare(
          `INSERT INTO mobile_order_request_items
             (id, request_id, menu_item_id, item_name_at_order, unit_price_at_order, quantity, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM mobile_order_requests
             WHERE id = ? AND status = 'awaiting_payment'
           )`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          item.menuItemId,
          item.name,
          item.price,
          item.quantity,
          now,
          id,
        ),
    ),
  ];

  try {
    const results = await d1.batch(statements);
    const requestChanges = Number(
      (results[1] as { meta?: { changes?: number } }).meta?.changes ?? 0,
    );
    if (requestChanges !== 1) throw new MobileOrderClosedError();
    const itemChanges = results
      .slice(2)
      .reduce(
        (sum, result) =>
          sum + Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0),
        0,
      );
    if (itemChanges !== snapshots.length) throw new Error("注文商品の保存に失敗しました。");
  } catch (error) {
    // 同じ idempotency key を別リクエストが先に確定した場合は、既存結果へ収束させる。
    const concurrent = await getRequestByIdempotencyKey(d1, storeToken, idempotencyKey);
    if (concurrent) {
      if (!sameCart(validItems, concurrent.items)) throw new MobileOrderConflictError();
      return concurrent;
    }
    throw error;
  }

  return {
    id,
    publicToken,
    businessDate,
    orderNumber: await getOrderNumber(d1, id),
    status: "awaiting_payment",
    orderStatus: null,
    createdAt: now,
    items: snapshots,
  };
}

async function getOrderNumber(d1: D1Database, requestId: string): Promise<number> {
  const row = await d1
    .prepare("SELECT order_number AS orderNumber FROM mobile_order_requests WHERE id = ?")
    .bind(requestId)
    .first<{ orderNumber: number }>();
  if (!row) throw new Error("注文の保存結果を確認できませんでした。");
  return row.orderNumber;
}
