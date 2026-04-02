import { redirect, Outlet } from "react-router";
import type { Route } from "./+types/_drip";

export async function loader({ request }: Route.LoaderArgs) {
  // TODO: スタッフ認証を実装する
  // const isStaff = await verifyStaffSession(request);
  // if (!isStaff) throw redirect("/");
  return null;
}

export default function DripLayout() {
  return <Outlet />;
}
