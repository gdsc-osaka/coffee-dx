import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import { redirect } from "react-router";
import * as authSchema from "../../db/auth-schema";
import { createAuthOptions } from "./auth-options";
import { staffReturnToFromRequest } from "./auth-url";

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

export async function requirePageStaff(request: Request, env: Env): Promise<AuthorizedUser> {
  const result = await authorizeStaff(request, env);
  if (result.ok) return result.user;
  if (result.status === 401) {
    const returnTo = staffReturnToFromRequest(request);
    throw redirect(`/staff/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  throw new Response("Forbidden", { status: 403 });
}

export async function requireApiStaff(request: Request, env: Env): Promise<AuthorizedUser> {
  const result = await authorizeStaff(request, env);
  if (result.ok) return result.user;
  throw new Response(result.status === 401 ? "Unauthorized" : "Forbidden", {
    status: result.status,
  });
}
