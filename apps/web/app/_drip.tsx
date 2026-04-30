import { Outlet } from "react-router";
import type { Route } from "./+types/_drip";

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest-drip.webmanifest" },
];

export const meta: Route.MetaFunction = () => [
  { title: "調理管理" },
  { name: "apple-mobile-web-app-title", content: "調理管理" },
  { name: "apple-mobile-web-app-status-bar-style", content: "default" },
  { name: "theme-color", content: "#ffffff" },
];

export async function loader({ request: _request }: Route.LoaderArgs) {
  // TODO: スタッフ認証を実装する
  // const isStaff = await verifyStaffSession(request);
  // if (!isStaff) throw redirect("/");
  return null;
}

export default function DripLayout() {
  return <Outlet />;
}
