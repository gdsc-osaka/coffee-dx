import { Outlet } from "react-router";
import type { Route } from "./+types/_order";
import { requirePageStaff } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePageStaff(request, context.cloudflare.env);
  return null;
}

export default function OrderLayout() {
  return <Outlet />;
}
