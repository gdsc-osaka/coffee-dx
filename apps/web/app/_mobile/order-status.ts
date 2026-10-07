import type { Route } from "./+types/order-status";
import { getMobileOrderStatusByPublicToken } from "~/features/mobile-order/actions";

const PUBLIC_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/**
 * QR再読込時と待機画面の定期更新で、現在状態だけを確認するための公開API。
 * 注文内容は返さず、公開トークンに紐づく注文の状態だけを返す。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const publicToken = params.publicToken;
  if (!publicToken || !PUBLIC_TOKEN_PATTERN.test(publicToken)) {
    return Response.json({ error: "注文が見つかりません" }, { status: 404 });
  }

  const status = await getMobileOrderStatusByPublicToken(context.cloudflare.env.DB, publicToken);
  if (!status) return Response.json({ error: "注文が見つかりません" }, { status: 404 });

  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
