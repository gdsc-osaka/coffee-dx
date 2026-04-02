import {
  type RouteConfig,
  index,
  layout,
  prefix,
} from "@react-router/dev/routes";

export default [
  // 客向け画面
  index("_customer/home.tsx"),

  // ドリップ係画面（loaderで認証ガード）
  layout("_drip.tsx", [
    ...prefix("drip", [index("_drip/home.tsx")]),
  ]),

  // 会計係画面（loaderで認証ガード）
  layout("_cashier.tsx", [
    ...prefix("cashier", [index("_cashier/home.tsx")]),
  ]),
] satisfies RouteConfig;
