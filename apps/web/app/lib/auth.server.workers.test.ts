/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as authSchema from "../../db/auth-schema";
import { createAuthOptions } from "./auth-options";
import { authorizeStaff, createAuth, requireApiStaff, requirePageStaff } from "./auth.server";
import { action as loginAction } from "../_staff/login";
import { action as logoutAction } from "../_staff/logout";

const testEnv = {
  ...env,
  BETTER_AUTH_SECRET: "auth-test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "https://example.com",
} as Env & { TEST_MIGRATIONS: D1Migration[] };

function createProvisioningAuth() {
  const options = createAuthOptions();
  return betterAuth({
    ...options,
    emailAndPassword: { ...options.emailAndPassword, disableSignUp: false, autoSignIn: false },
    database: drizzleAdapter(drizzle(testEnv.DB, { schema: authSchema }), {
      provider: "sqlite",
      schema: authSchema,
    }),
    secret: testEnv.BETTER_AUTH_SECRET,
    baseURL: testEnv.BETTER_AUTH_URL,
  });
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM session"),
    testEnv.DB.prepare("DELETE FROM account"),
    testEnv.DB.prepare("DELETE FROM user"),
  ]);
});

describe("staff authentication", () => {
  it("provisions an internal email and authenticates by username", async () => {
    const provisioner = createProvisioningAuth();
    const created = await provisioner.api.signUpEmail({
      body: {
        email: `staff-${crypto.randomUUID()}@auth.invalid`,
        name: "Test Staff",
        username: "teststaff",
        password: "test-password-1234",
      },
    });
    expect(created.user.role).toBe("staff");
    expect(created.user.isActive).toBe(true);

    const response = await createAuth(testEnv).api.signInUsername({
      body: { username: "teststaff", password: "test-password-1234" },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie");
    expect(cookie).toContain("better-auth.session_token");
    const request = new Request("https://example.com/order", {
      headers: { Cookie: cookie!.split(";")[0] },
    });
    expect((await authorizeStaff(request, testEnv)).ok).toBe(true);

    await testEnv.DB.prepare("UPDATE user SET is_active = 0 WHERE username = ?")
      .bind("teststaff")
      .run();
    await expect(requireApiStaff(request, testEnv)).rejects.toMatchObject({ status: 403 });
  });

  it("disables signup and username availability in Better Auth", async () => {
    const auth = createAuth(testEnv);
    const signup = await auth.handler(
      new Request("https://example.com/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "staff@example.com",
          name: "Staff",
          password: "test-password-1234",
          username: "teststaff",
        }),
      }),
    );
    expect(signup.ok).toBe(false);

    const availability = await auth.handler(
      new Request("https://example.com/api/auth/is-username-available", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "teststaff" }),
      }),
    );
    expect(availability.status).toBe(404);
  });

  it("redirects pages with returnTo and rejects API requests with 401", async () => {
    const request = new Request("https://example.com/cashier?tab=history");
    await expect(requirePageStaff(request, testEnv)).rejects.toMatchObject({
      status: 302,
      headers: expect.objectContaining({}),
    });
    try {
      await requirePageStaff(request, testEnv);
    } catch (response) {
      expect((response as Response).headers.get("Location")).toBe(
        "/staff/login?returnTo=%2Fcashier%3Ftab%3Dhistory",
      );
    }
    await expect(requireApiStaff(request, testEnv)).rejects.toMatchObject({ status: 401 });
  });

  it("sets a session cookie on form login and revokes it on logout", async () => {
    await createProvisioningAuth().api.signUpEmail({
      body: {
        email: `staff-${crypto.randomUUID()}@auth.invalid`,
        name: "Test Staff",
        username: "teststaff",
        password: "test-password-1234",
      },
    });
    const context = { cloudflare: { env: testEnv } };
    const loginRequest = new Request("https://example.com/staff/login", {
      method: "POST",
      body: new URLSearchParams({
        username: "teststaff",
        password: "test-password-1234",
        returnTo: "/cashier?tab=history",
      }),
    });
    let loginResponse: Response | undefined;
    try {
      await loginAction({ request: loginRequest, context } as unknown as Parameters<
        typeof loginAction
      >[0]);
    } catch (error) {
      loginResponse = error as Response;
    }
    expect(loginResponse?.status).toBe(302);
    expect(loginResponse?.headers.get("Location")).toBe("/cashier?tab=history");
    const cookie = loginResponse?.headers.get("Set-Cookie")?.split(";")[0];
    expect(cookie).toContain("better-auth.session_token");
    const authenticatedRequest = new Request("https://example.com/cashier", {
      headers: { Cookie: cookie! },
    });
    expect((await authorizeStaff(authenticatedRequest, testEnv)).ok).toBe(true);

    let logoutResponse: Response | undefined;
    try {
      await logoutAction({ request: authenticatedRequest, context } as unknown as Parameters<
        typeof logoutAction
      >[0]);
    } catch (error) {
      logoutResponse = error as Response;
    }
    expect(logoutResponse?.status).toBe(302);
    expect(logoutResponse?.headers.get("Location")).toBe("/staff/login");
    expect(logoutResponse?.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await authorizeStaff(authenticatedRequest, testEnv)).ok).toBe(false);
  });
});
