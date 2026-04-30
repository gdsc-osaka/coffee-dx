import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  // 客向け画面
  index("_customer/home.tsx"),

  // ドリップ係画面（loaderで認証ガード）
  layout("_drip.tsx", [...prefix("drip", [index("_drip/home.tsx")])]),

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
