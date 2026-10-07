import { Form, Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/mobile-order-checkout";
import {
  getConfiguredMobileStoreToken,
  getMobileOrderAcceptance,
  setMobileOrderAcceptance,
} from "~/features/mobile-order/actions";
import { mobileOrderAcceptanceIntentSchema } from "~/features/mobile-order/schemas";
import { getBusinessDate, getOrderDOStub } from "~/lib/order-do";
type PendingMobileOrderItem = {
  menuItemId: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
};

type PendingMobileOrder = {
  id: string;
  orderNumber: number;
  businessDate: string;
  createdAt: string;
  items: PendingMobileOrderItem[];
  total: number;
};

type MobileOrderRow = Omit<PendingMobileOrder, "items" | "total"> & PendingMobileOrderItem;
async function forwardMobileOrderAction(
  stub: DurableObjectStub,
  requestId: string,
  businessDate: string,
  intent: "pay" | "cancel",
): Promise<Response> {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await stub.fetch(
        new Request(
          new URL(`/do/mobile-orders/${encodeURIComponent(requestId)}/${intent}`, "https://do"),
          { method: "POST", headers: { "x-event-id": businessDate } },
        ),
      );
      if (
        response.ok ||
        response.status === 400 ||
        response.status === 404 ||
        response.status === 409
      ) {
        return response;
      }
      lastResponse = response;
    } catch {
      // 一時的なDO通信失敗は、同じリクエストを再送してD1の既存結果を再反映する。
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (lastResponse) return lastResponse;
  throw new Error("OrderDO request failed");
}
export async function loader({ context }: Route.LoaderArgs) {
  const storeToken = getConfiguredMobileStoreToken(context.cloudflare.env);
  const businessDate = getBusinessDate();
  const isAccepting = await getMobileOrderAcceptance(
    context.cloudflare.env.DB,
    storeToken,
    businessDate,
  );
  const { results } = await context.cloudflare.env.DB.prepare(
    `SELECT r.id, r.order_number AS orderNumber, r.business_date AS businessDate,
            r.created_at AS createdAt, i.menu_item_id AS menuItemId,
            i.item_name_at_order AS itemName, i.unit_price_at_order AS unitPrice,
            i.quantity
       FROM mobile_order_requests r
       JOIN mobile_order_request_items i ON i.request_id = r.id
      WHERE r.store_token = ? AND r.status = 'awaiting_payment'
      ORDER BY r.business_date, r.order_number, i.rowid`,
  )
    .bind(storeToken)
    .all<MobileOrderRow>();

  const orderMap = new Map<string, PendingMobileOrder>();
  for (const row of results) {
    const order = orderMap.get(row.id) ?? {
      id: row.id,
      orderNumber: row.orderNumber,
      businessDate: row.businessDate,
      createdAt: row.createdAt,
      items: [],
      total: 0,
    };
    order.items.push({
      menuItemId: row.menuItemId,
      itemName: row.itemName,
      unitPrice: row.unitPrice,
      quantity: row.quantity,
    });
    order.total += row.unitPrice * row.quantity;
    orderMap.set(row.id, order);
  }

  return { storeToken, businessDate, isAccepting, pendingOrders: [...orderMap.values()] };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const acceptanceIntent = mobileOrderAcceptanceIntentSchema.safeParse(intent);
  if (acceptanceIntent.success) {
    const storeToken = getConfiguredMobileStoreToken(context.cloudflare.env);
    await setMobileOrderAcceptance(
      context.cloudflare.env.DB,
      storeToken,
      acceptanceIntent.data === "resume",
      getBusinessDate(),
    );
    return {
      ok: true as const,
      kind: "acceptance" as const,
      isAccepting: acceptanceIntent.data === "resume",
    };
  }

  if (intent !== "pay" && intent !== "cancel") {
    return { ok: false as const, error: "操作を指定してください。" };
  }
  const requestId = formData.get("requestId");
  const businessDate = formData.get("businessDate");
  if (typeof requestId !== "string" || typeof businessDate !== "string") {
    return { ok: false as const, error: "注文情報が不正です。画面を再読み込みしてください。" };
  }
  try {
    const stub = getOrderDOStub(context.cloudflare.env, businessDate);
    const response = await forwardMobileOrderAction(stub, requestId, businessDate, intent);
    if (!response.ok) {
      return {
        ok: false as const,
        error:
          intent === "pay"
            ? response.status === 409
              ? "この注文は会計できません。営業日または注文状態を確認してください。"
              : "会計に失敗しました。もう一度お試しください。"
            : response.status === 409
              ? "この注文は取り消せません。すでに会計済みの可能性があります。"
              : "注文の取り消しに失敗しました。もう一度お試しください。",
      };
    }
    return { ok: true as const, kind: "order" as const, intent };
  } catch {
    return {
      ok: false as const,
      error:
        intent === "pay"
          ? "会計に失敗しました。もう一度お試しください。"
          : "注文の取り消しに失敗しました。もう一度お試しください。",
    };
  }
}

export default function MobileOrderCheckout({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isAccepting =
    actionData?.ok && actionData.kind === "acceptance"
      ? actionData.isAccepting
      : loaderData.isAccepting;

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs tracking-widest text-stone-400">MOBILE ORDER</p>
            <h1 className="mt-1 text-2xl font-bold text-stone-800">モバイルオーダー会計</h1>
          </div>
          <Link
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-stone-800 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800 sm:w-auto"
            to="/order"
          >
            <span aria-hidden="true">←</span>
            注文画面へ戻る
          </Link>
        </header>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-stone-500">現在の受付状態</p>
              <p
                className={`mt-1 text-xl font-bold ${isAccepting ? "text-emerald-700" : "text-amber-700"}`}
              >
                {isAccepting ? "受付中" : "受付停止中"}
              </p>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value={isAccepting ? "stop" : "resume"} />
              <button
                type="submit"
                disabled={isSubmitting}
                onClick={(event) => {
                  const message = isAccepting
                    ? "新しいモバイル注文の受付を停止しますか？"
                    : "モバイル注文の受付を再開しますか？";
                  if (!window.confirm(message)) event.preventDefault();
                }}
                className={`rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-50 ${
                  isAccepting
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {isSubmitting ? "更新中..." : isAccepting ? "受付停止" : "受付再開"}
              </button>
            </Form>
          </div>
          {actionData && !actionData.ok && (
            <p className="mt-3 text-sm text-red-600">{actionData.error}</p>
          )}
          {actionData?.ok && actionData.kind === "order" && (
            <p className="mt-3 text-sm text-emerald-700">注文を更新しました。</p>
          )}
          <p className="mt-3 text-xs text-stone-400">
            受付状態は新規注文にのみ適用されます。受付停止中でも、すでに受け付けた注文は会計できます。
          </p>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-stone-800">会計待ち</h2>
            <span className="text-sm text-stone-400">{loaderData.pendingOrders.length}件</span>
          </div>
          {loaderData.pendingOrders.length === 0 ? (
            <p className="mt-5 text-sm text-stone-400">会計待ちのモバイル注文はありません。</p>
          ) : (
            <ul className="mt-4 divide-y divide-stone-100">
              {loaderData.pendingOrders.map((order) => {
                return (
                  <li key={order.id} className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-bold text-stone-800">#{order.orderNumber}</p>
                        <p className="text-xs text-stone-400">
                          {order.businessDate} / {order.createdAt}
                        </p>
                        <ul className="mt-2 space-y-1 text-sm text-stone-600">
                          {order.items.map((item) => (
                            <li key={item.menuItemId}>
                              {item.itemName} × {item.quantity}（{item.unitPrice * item.quantity}
                              円）
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-sm font-bold text-stone-800">
                          合計 {order.total}円
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <Form method="post">
                          <input type="hidden" name="requestId" value={order.id} />
                          <input type="hidden" name="businessDate" value={order.businessDate} />
                          <button
                            type="submit"
                            name="intent"
                            value="pay"
                            disabled={isSubmitting}
                            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
                          >
                            会計完了
                          </button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="requestId" value={order.id} />
                          <input type="hidden" name="businessDate" value={order.businessDate} />
                          <button
                            type="submit"
                            name="intent"
                            value="cancel"
                            disabled={isSubmitting}
                            onClick={(event) => {
                              if (!window.confirm("この注文を取り消しますか？"))
                                event.preventDefault();
                            }}
                            className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50"
                          >
                            注文取消
                          </button>
                        </Form>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}