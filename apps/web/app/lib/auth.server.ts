import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import { redirect } from "react-router";
import * as authSchema from "../../db/auth-schema";
import { createAuthOptions } from "./auth-options";
import { isStaffPath, safeStaffReturnTo } from "./auth-url";

export type Role = "staff" | "manager";
export type AuthorizedUser = {
  userId: string;
  role: Role;
  sessionId: string;
  expiresAt: Date;
};

type AuthorizationResult = { ok: true; user: AuthorizedUser } | { ok: false; status: 401 | 403 };

export function createAuth(env: Env) {
  return betterAuth({
    ...createAuthOptions(),
    database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), {
      provider: "sqlite",
      schema: authSchema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  });
}

export async function authorizeStaff(request: Request, env: Env): Promise<AuthorizationResult> {
  const result = await createAuth(env).api.getSession({ headers: request.headers });
  if (!result) return { ok: false, status: 401 };
  if (result.user.isActive !== true || result.user.role !== "staff") {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    user: {
      userId: result.user.id,
      role: "staff",
      sessionId: result.session.id,
      expiresAt: result.session.expiresAt,
    },
  };
}

/** Gate all staff HTTP routes before React Router runs any loader or action. */
export async function guardStaffRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  let pathname: string;
  try {
    // React Router matches paths without regard to case and decodes escapes.
    pathname = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  // React Router strips this suffix for client navigation and form submissions.
  const routePath = pathname.replace(/\/_\.data$|\.data$/, "");
  if (!isStaffPath(routePath)) return null;

  const result = await authorizeStaff(request, env);
  if (result.ok) return null;
  if (result.status === 403) return new Response("Forbidden", { status: 403 });
  const resourcePath = routePath.replace(/\/+$/, "");
  if (resourcePath === "/cashier/orders-history" || resourcePath === "/cashier/leftover-orders") {
    return new Response("Unauthorized", { status: 401 });
  }
  const returnTo = safeStaffReturnTo(`${routePath}${url.search}`);
  return redirect(`/staff/login?returnTo=${encodeURIComponent(returnTo)}`);
}
