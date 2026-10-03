import { Form, Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/mobile-order-checkout";
import {
  getConfiguredMobileStoreToken,
  getMobileOrderAcceptance,
  setMobileOrderAcceptance,
} from "~/features/mobile-order/actions";
import { getBusinessDate } from "~/lib/order-do";

type PendingMobileOrder = {
  id: string;
  orderNumber: number;
  businessDate: string;
  createdAt: string;
};

export async function loader({ context }: Route.LoaderArgs) {
  const storeToken = getConfiguredMobileStoreToken(context.cloudflare.env);
  const businessDate = getBusinessDate();
  const isAccepting = await getMobileOrderAcceptance(
    context.cloudflare.env.DB,
    storeToken,
    businessDate,
  );
  const { results } = await context.cloudflare.env.DB.prepare(
    `SELECT id, order_number AS orderNumber, business_date AS businessDate, created_at AS createdAt
       FROM mobile_order_requests
       WHERE store_token = ? AND status = 'awaiting_payment'
       ORDER BY business_date, order_number`,
  )
    .bind(storeToken)
    .all<PendingMobileOrder>();

  return { storeToken, businessDate, isAccepting, pendingOrders: results };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "stop" && intent !== "resume") {
    return { ok: false as const, error: "受付状態の操作が不正です。" };
  }

  const storeToken = getConfiguredMobileStoreToken(context.cloudflare.env);
  await setMobileOrderAcceptance(
    context.cloudflare.env.DB,
    storeToken,
    intent === "resume",
    getBusinessDate(),
  );
  return { ok: true as const, isAccepting: intent === "resume" };
}

export default function MobileOrderCheckout({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isAccepting = actionData?.ok ? actionData.isAccepting : loaderData.isAccepting;

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs tracking-widest text-stone-400">MOBILE ORDER</p>
            <h1 className="mt-1 text-2xl font-bold text-stone-800">モバイルオーダー会計</h1>
          </div>
          <Link className="text-sm text-stone-500 underline" to="/order">
            注文管理へ戻る
          </Link>
        </header>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-stone-500">本日の受付状態</p>
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
          <p className="mt-3 text-xs text-stone-400">
            受付状態は新規注文だけに適用されます。受付停止中も既存の会計待ち注文は確認できます。
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
              {loaderData.pendingOrders.map((order) => (
                <li key={order.id} className="flex items-center justify-between py-3">
                  <span className="text-lg font-bold text-stone-800">#{order.orderNumber}</span>
                  <span className="text-xs text-stone-400">
                    {order.businessDate} / {order.createdAt}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
