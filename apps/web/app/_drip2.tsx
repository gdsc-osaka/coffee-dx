import { Outlet } from "react-router";
import type { Route } from "./+types/_drip2";
import { requirePageStaff } from "~/lib/auth.server";

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest-drip.webmanifest" },
];

export const meta: Route.MetaFunction = () => [
  { title: "調理管理 (新 UI)" },
  { name: "apple-mobile-web-app-title", content: "調理管理" },
  { name: "apple-mobile-web-app-status-bar-style", content: "default" },
  { name: "theme-color", content: "#ffffff" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePageStaff(request, context.cloudflare.env);
  return null;
}

export default function Drip2Layout() {
  return <Outlet />;
}
