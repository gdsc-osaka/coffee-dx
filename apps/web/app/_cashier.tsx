import { Outlet } from "react-router";
import type { Route } from "./+types/_cashier";

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest-cashier.webmanifest" },
];

export const meta: Route.MetaFunction = () => [
  { title: "受渡管理" },
  { name: "apple-mobile-web-app-title", content: "受渡管理" },
  { name: "apple-mobile-web-app-status-bar-style", content: "default" },
  { name: "theme-color", content: "#ffffff" },
];

export async function loader({ request: _request }: Route.LoaderArgs) {
  // TODO: スタッフ認証を実装する
  // const isStaff = await verifyStaffSession(request);
  // if (!isStaff) throw redirect("/");
  return null;
}

export default function CashierLayout() {
  return <Outlet />;
}
