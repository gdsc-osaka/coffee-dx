import { Outlet } from "react-router";
import type { Route } from "./+types/_drip2";

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest-drip.webmanifest" },
];

export const meta: Route.MetaFunction = () => [
  { title: "調理管理 (新 UI)" },
  { name: "apple-mobile-web-app-title", content: "調理管理" },
  { name: "apple-mobile-web-app-status-bar-style", content: "default" },
  { name: "theme-color", content: "#ffffff" },
];

export async function loader({ request: _request }: Route.LoaderArgs) {
  // TODO: スタッフ認証を実装する（_drip.tsx と同じ）
  return null;
}

export default function Drip2Layout() {
  return <Outlet />;
}
