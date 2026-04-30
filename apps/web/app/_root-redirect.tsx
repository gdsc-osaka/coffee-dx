import { redirect } from "react-router";
import type { Route } from "./+types/_root-redirect";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect(`/order${url.search}`);
}

export default function RootRedirect() {
  return null;
}
