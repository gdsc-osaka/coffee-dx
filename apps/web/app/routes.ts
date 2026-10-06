import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  // ルートは客向け画面（/order）へリダイレクト
  // PWA scope を役割ごとに完全分離するため、customer は /order に置く
  // （Chrome は scope 重複した PWA の同時インストールを抑制するため）
  index("_root-redirect.tsx"),

  // 店頭注文・会計画面（スタッフ向け）。認証は別ブランチで実装予定（PR #52 のコメントより）。
  layout("_order.tsx", [route("order", "_order/home.tsx")]),
  route("mobile/:storeToken", "_mobile/home.tsx"),
  route("mobile/orders/:publicToken/status", "_mobile/order-status.ts"),
  route("mobile/orders/:publicToken", "_mobile/order-receipt.tsx"),
  route("order/mobile-checkout", "_cashier/mobile-order-checkout.tsx"),
  // 商品登録ページ（issue #51）。mobile-checkout と同じく /order 配下に置く。
  route("order/menu-items", "_cashier/menu-items.tsx"),
  index("_root-redirect.tsx"),

  // ドリップ係画面（loaderで認証ガード）
  layout("_drip.tsx", [...prefix("drip", [index("_drip/home.tsx")])]),

  // ドリップ係画面 新 UI（物理レーン × タイマー統合版、/drip と並走運用）
  layout("_drip2.tsx", [...prefix("drip2", [index("_drip2/home.tsx")])]),

  // 会計係画面（loaderで認証ガード）
  // orders-history は会計係向けのデータ取得 API。CashierHeader の履歴ダイアログから fetch されるが、
  // ルート定義上は _cashier レイアウト配下に置いて auth ガードの対象に含める。
  layout("_cashier.tsx", [
    ...prefix("cashier", [
      index("_cashier/home.tsx"),
      route("orders-history", "_cashier/orders-history.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
