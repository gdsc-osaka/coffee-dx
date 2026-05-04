import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  // ルートは客向け画面（/order）へリダイレクト
  // PWA scope を役割ごとに完全分離するため、customer は /order に置く
  // （Chrome は scope 重複した PWA の同時インストールを抑制するため）
  index("_root-redirect.tsx"),

  // 客向け画面
  route("order", "_customer/home.tsx"),

  // ドリップ係画面（loaderで認証ガード）
  layout("_drip.tsx", [...prefix("drip", [index("_drip/home.tsx")])]),

  // ドリップ係画面 新 UI（物理レーン × タイマー統合版、/drip と並走運用）
  layout("_drip2.tsx", [...prefix("drip2", [index("_drip2/home.tsx")])]),

  // 会計係画面（loaderで認証ガード）
  // orders-history / leftover-orders は会計係向けのデータ取得 API。
  // それぞれ CashierHeader の履歴ダイアログ・/cashier の警告バナーから fetch される。
  // ルート定義上は _cashier レイアウト配下に置いて auth ガードの対象に含める。
  layout("_cashier.tsx", [
    ...prefix("cashier", [
      index("_cashier/home.tsx"),
      route("orders-history", "_cashier/orders-history.tsx"),
      route("leftover-orders", "_cashier/leftover-orders.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
