import type { Route } from "./+types/auth-api";
import { createAuth } from "~/lib/auth.server";

// 公開 HTTP 入口は必要な API だけに限定する。スタッフ画面はサーバー API を直接使う。
const allowedPaths = new Set([
  "/api/auth/sign-in/username",
  "/api/auth/sign-out",
  "/api/auth/get-session",
]);

function handle(request: Request, env: Env) {
  if (!allowedPaths.has(new URL(request.url).pathname)) {
    return new Response("Not Found", { status: 404 });
  }
  return createAuth(env).handler(request);
}

export function loader({ request, context }: Route.LoaderArgs) {
  return handle(request, context.cloudflare.env);
}

export function action({ request, context }: Route.ActionArgs) {
  return handle(request, context.cloudflare.env);
}
