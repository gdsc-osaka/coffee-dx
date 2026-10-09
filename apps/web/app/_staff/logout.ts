import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { createAuth } from "~/lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const response = await createAuth(context.cloudflare.env).api.signOut({
    headers: request.headers,
    asResponse: true,
  });
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  throw redirect("/staff/login", { headers });
}
