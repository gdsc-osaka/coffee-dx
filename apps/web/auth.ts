import { betterAuth } from "better-auth";
import { createAuthOptions } from "./app/lib/auth-options";

// Better Auth CLI のスキーマ生成用。実際のリクエストでは auth.server.ts が D1 を渡す。
export const auth = betterAuth(createAuthOptions());
