import { redirect, Outlet } from "react-router";
import type { Route } from "./+types/_cashier";

export async function loader({ request }: Route.LoaderArgs) {
  // TODO: スタッフ認証を実装する
  // const isStaff = await verifyStaffSession(request);
  // if (!isStaff) throw redirect("/");
  return null;
}

export default function CashierLayout() {
  return <Outlet />;
}
