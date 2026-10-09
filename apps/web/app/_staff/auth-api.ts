import type { Route } from "./+types/auth-api";
import { createAuth } from "~/lib/auth.server";
import { checkLoginRateLimit } from "~/lib/login-rate-limit.server";

// 公開 HTTP 入口は必要な API だけに限定する。スタッフ画面はサーバー API を直接使う。
const allowedPaths = new Set([
  "/api/auth/sign-in/username",
  "/api/auth/sign-out",
  "/api/auth/get-session",
]);

async function handle(request: Request, env: Env) {
  const path = new URL(request.url).pathname;
  if (!allowedPaths.has(path)) {
    return new Response("Not Found", { status: 404 });
  }
  if (path === "/api/auth/sign-in/username") {
    let username = "";
    try {
      const body = (await request.clone().json()) as { username?: unknown };
      if (typeof body.username === "string") username = body.username;
    } catch {
      // Malformed bodies still consume the IP attempt budget.
    }
    const rateLimit = await checkLoginRateLimit(request, env, username);
    if (rateLimit) return rateLimit;
  }
  return createAuth(env).handler(request);
}

export function loader({ request, context }: Route.LoaderArgs) {
  return handle(request, context.cloudflare.env);
}

export function action({ request, context }: Route.ActionArgs) {
  return handle(request, context.cloudflare.env);
}
