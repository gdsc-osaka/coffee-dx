import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  // 客向け画面
  index("_customer/home.tsx"),

  // 過去注文履歴の Resource Route（CashierHeader の履歴ダイアログから fetch）
  route("orders-history", "_customer/orders-history.tsx"),

  // ドリップ係画面（loaderで認証ガード）
  layout("_drip.tsx", [...prefix("drip", [index("_drip/home.tsx")])]),

  // 会計係画面（loaderで認証ガード）
  layout("_cashier.tsx", [...prefix("cashier", [index("_cashier/home.tsx")])]),
] satisfies RouteConfig;
