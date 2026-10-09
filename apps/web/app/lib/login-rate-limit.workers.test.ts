/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkLoginRateLimit } from "./login-rate-limit.server";

const testEnv = {
  ...env,
  BETTER_AUTH_SECRET: "rate-test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "https://example.com",
} as Env & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.DB.prepare("DELETE FROM auth_login_attempts").run();
});

describe("shared login attempt limit", () => {
  it("limits both IP and username across Worker calls and resets after the window", async () => {
    const request = new Request("https://example.com/staff/login", {
      headers: { "CF-Connecting-IP": "192.0.2.10" },
    });
    for (let i = 0; i < 5; i++) {
      expect(await checkLoginRateLimit(request, testEnv, "alice")).toBeNull();
    }
    expect((await checkLoginRateLimit(request, testEnv, "bob"))?.status).toBe(429);
    const anotherIp = new Request(request, { headers: { "CF-Connecting-IP": "192.0.2.11" } });
    expect((await checkLoginRateLimit(anotherIp, testEnv, "alice"))?.status).toBe(429);
    await testEnv.DB.prepare("UPDATE auth_login_attempts SET reset_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect(await checkLoginRateLimit(request, testEnv, "alice")).toBeNull();
  });

  it("deletes expired counters while retaining active windows", async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO auth_login_attempts (key, count, reset_at) VALUES (?, ?, ?)",
      ).bind("expired", 1, Date.now() - 1),
      testEnv.DB.prepare(
        "INSERT INTO auth_login_attempts (key, count, reset_at) VALUES (?, ?, ?)",
      ).bind("active", 1, Date.now() + 60_000),
    ]);
    await checkLoginRateLimit(new Request("https://example.com/staff/login"), testEnv, "alice");
    const rows = await testEnv.DB.prepare("SELECT key FROM auth_login_attempts").all<{
      key: string;
    }>();
    expect(rows.results.map((row) => row.key)).toContain("active");
    expect(rows.results.map((row) => row.key)).not.toContain("expired");
  });
});
