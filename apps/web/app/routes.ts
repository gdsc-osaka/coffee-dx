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

  // 会計係画面（loaderで認証ガード）
  layout("_cashier.tsx", [...prefix("cashier", [index("_cashier/home.tsx")])]),
] satisfies RouteConfig;
