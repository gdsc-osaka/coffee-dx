import type { Route } from "./+types/order-receipt";
import { getMobileOrderByPublicToken } from "~/features/mobile-order/actions";

export async function loader({ params, context }: Route.LoaderArgs) {
  const publicToken = params.publicToken;
  if (!publicToken || !/^[0-9a-f]{32}$/.test(publicToken)) {
    throw new Response("注文が見つかりません", { status: 404 });
  }
  const order = await getMobileOrderByPublicToken(context.cloudflare.env.DB, publicToken);
  if (!order) throw new Response("注文が見つかりません", { status: 404 });
  return { order };
}

export default function MobileOrderReceipt({ loaderData }: Route.ComponentProps) {
  const { order } = loaderData;
  const status = {
    awaiting_payment: {
      title: "会計待ち",
      instruction: "この画面をレジで提示して、会計をお済ませください。",
    },
    paid: { title: "会計済み", instruction: "抽出と受け取りの状況はスタッフにご確認ください。" },
    cancelled: { title: "取消済み", instruction: "この注文は取り消されました。" },
  }[order.status];

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-10">
      <section className="mx-auto max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-stone-500">注文控え</p>
        <h1 className="mt-3 text-7xl font-black text-stone-900">#{order.orderNumber}</h1>
        <p className="mt-5 text-lg font-bold text-stone-800">{status.title}</p>
        <p className="mt-2 text-sm text-stone-500">{status.instruction}</p>
        <div className="mt-7 space-y-2 border-t border-stone-100 pt-5 text-left">
          <p className="pb-2 text-xs text-stone-500">注文日時：{order.createdAt}</p>
          {order.items.map((item) => (
            <div key={item.menuItemId} className="flex justify-between text-sm text-stone-700">
              <span>{item.name}</span>
              <span>× {item.quantity}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
