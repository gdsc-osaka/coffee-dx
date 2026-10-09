import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "./db/auth-schema";
import { createAuthOptions } from "./app/lib/auth-options";

type ProvisionEnv = Env & {
  STAFF_USERNAME: string;
  STAFF_PASSWORD: string;
  STAFF_DISPLAY_NAME: string;
  RETIRE_USER_ID?: string;
};

type ExistingUser = { id: string; username: string | null; isActive: number };

/** This module is deployed separately and exposes only a scheduled handler. */
export async function runProvisioning(env: ProvisionEnv): Promise<string> {
  const { STAFF_PASSWORD: password, STAFF_DISPLAY_NAME: name } = env;
  const username = env.STAFF_USERNAME?.toLowerCase();
  if (!/^[a-z0-9_.]{3,30}$/.test(username ?? "")) {
    throw new Error("Invalid STAFF_USERNAME");
  }
  if (!password || password.length < 12 || password.length > 128 || !name?.trim()) {
    throw new Error("Missing or invalid provisioning credentials");
  }
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
    throw new Error("Missing Better Auth configuration");
  }

  const existing = await env.DB.prepare(
    "SELECT id, username, is_active AS isActive FROM user WHERE username = ?",
  )
    .bind(username)
    .first<ExistingUser>();

  let old: ExistingUser | null = null;
  if (env.RETIRE_USER_ID) {
    old = await env.DB.prepare("SELECT id, username, is_active AS isActive FROM user WHERE id = ?")
      .bind(env.RETIRE_USER_ID)
      .first<ExistingUser>();
    if (!old) throw new Error("RETIRE_USER_ID does not exist");
    if (existing && existing.id !== old.id) {
      if (old.isActive === 0 && existing.isActive === 1) return existing.id;
      throw new Error("Replacement username already belongs to another user");
    }
  } else if (existing) {
    if (existing.isActive === 1) return existing.id;
    throw new Error("Username belongs to a retired account");
  }

  const options = createAuthOptions();
  const auth = betterAuth({
    ...options,
    emailAndPassword: { ...options.emailAndPassword, disableSignUp: false, autoSignIn: false },
    database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), {
      provider: "sqlite",
      schema: authSchema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  });
  // Better Auth normalizes usernames. A temporary name allows the replacement
  // credentials to be created before atomically retiring the old account.
  const temporaryUsername =
    old?.isActive === 1
      ? `handoff_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`
      : username;
  const result = await auth.api.signUpEmail({
    body: {
      email: `staff-${crypto.randomUUID()}@auth.invalid`,
      name: name.trim(),
      username: temporaryUsername,
      password,
    },
  });
  if (result.user.role !== "staff" || result.user.isActive !== true) {
    throw new Error("Provisioned user has unexpected authorization fields");
  }

  if (old?.isActive === 1) {
    const retiredUsername = `retired_${crypto.randomUUID().replaceAll("-", "")}`;
    const now = Date.now();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE user SET is_active = 0, username = ?, display_username = ?, updated_at = ? WHERE id = ?",
        ).bind(retiredUsername, retiredUsername, now, old.id),
        env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(old.id),
        env.DB.prepare("DELETE FROM account WHERE user_id = ?").bind(old.id),
        env.DB.prepare(
          "UPDATE user SET username = ?, display_username = ?, updated_at = ? WHERE id = ?",
        ).bind(username, username, now, result.user.id),
      ]);
    } catch (error) {
      // A failed batch leaves the old account active; remove the temporary user.
      await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(result.user.id).run();
      throw error;
    }
  }
  return result.user.id;
}

export default {
  async scheduled(_controller: ScheduledController, env: ProvisionEnv) {
    const userId = await runProvisioning(env);
    console.log(`Provisioning completed for user ID ${userId}`);
  },
} satisfies ExportedHandler<ProvisionEnv>;
