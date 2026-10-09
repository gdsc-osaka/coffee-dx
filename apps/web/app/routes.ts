import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  // ルートは店頭注文・会計画面（/order）へリダイレクト
  // 注文管理 PWA の scope は /order/ に限定する
  // （Chrome は scope 重複した PWA の同時インストールを抑制するため）
  index("_root-redirect.tsx"),

  route("staff/login", "_staff/login.tsx"),
  route("staff/logout", "_staff/logout.ts"),

  // 店頭注文とモバイル注文の会計・商品管理画面（スタッフ向け）。
  layout("_order.tsx", [
    route("order", "_order/home.tsx"),
    route("order/mobile-checkout", "_cashier/mobile-order-checkout.tsx"),
    route("order/menu-items", "_cashier/menu-items.tsx"),
  ]),

  // 店舗固定QRから開く公開画面
  route("mobile/:storeToken", "_mobile/home.tsx"),
  route("mobile/orders/:publicToken/status", "_mobile/order-status.ts"),
  route("mobile/orders/:publicToken", "_mobile/order-receipt.tsx"),

  // ドリップ係画面（loaderで認証ガード）
  layout("_drip.tsx", [...prefix("drip", [index("_drip/home.tsx")])]),

  // ドリップ係画面 新 UI（物理レーン × タイマー統合版、/drip と並走運用）
  layout("_drip2.tsx", [...prefix("drip2", [index("_drip2/home.tsx")])]),

  // 会計係画面（loaderで認証ガード）
  // orders-history / leftover-orders は会計係向けのデータ取得 API。
  // それぞれ CashierHeader の履歴ダイアログ・/cashier の警告バナーから fetch される。
  // URL を /cashier 配下にそろえるため _cashier レイアウト配下に置くが、default export のない
  // リソースルートは直接リクエストされても親レイアウトの loader が実行されない。
  // そのため _cashier の認証ガードは効かず、各 loader で個別に認証する必要がある。
  layout("_cashier.tsx", [
    ...prefix("cashier", [
      index("_cashier/home.tsx"),
      route("orders-history", "_cashier/orders-history.tsx"),
      route("leftover-orders", "_cashier/leftover-orders.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
