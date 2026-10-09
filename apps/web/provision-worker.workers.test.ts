/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeStaff, createAuth } from "./app/lib/auth.server";
import { runProvisioning } from "./provision-worker";

const testEnv = {
  ...env,
  BETTER_AUTH_SECRET: "provision-test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "https://example.com",
  STAFF_USERNAME: "teststaff",
  STAFF_PASSWORD: "test-password-1234",
  STAFF_DISPLAY_NAME: "Test Staff",
} as Env & {
  TEST_MIGRATIONS: D1Migration[];
  STAFF_USERNAME: string;
  STAFF_PASSWORD: string;
  STAFF_DISPLAY_NAME: string;
  RETIRE_USER_ID?: string;
};

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

describe("private staff provisioning", () => {
  it("creates a staff account once and validates username login", async () => {
    const mixedCaseEnv = { ...testEnv, STAFF_USERNAME: "TestStaff" };
    const userId = await runProvisioning(mixedCaseEnv);
    expect(await runProvisioning(mixedCaseEnv)).toBe(userId);
    expect(await runProvisioning(testEnv)).toBe(userId);
    const user = await testEnv.DB.prepare("SELECT username, role, is_active FROM user WHERE id = ?")
      .bind(userId)
      .first<{ username: string; role: string; is_active: number }>();
    expect(user).toEqual({ username: "teststaff", role: "staff", is_active: 1 });
    const count = await testEnv.DB.prepare("SELECT count(*) AS count FROM user").first<{
      count: number;
    }>();
    expect(count?.count).toBe(1);

    const login = await createAuth(testEnv).api.signInUsername({
      body: { username: testEnv.STAFF_USERNAME, password: testEnv.STAFF_PASSWORD },
      asResponse: true,
    });
    expect(login.status).toBe(200);
  });

  it("retires the old credentials and sessions before issuing a replacement", async () => {
    const oldId = await runProvisioning(testEnv);
    const login = await createAuth(testEnv).api.signInUsername({
      body: { username: testEnv.STAFF_USERNAME, password: testEnv.STAFF_PASSWORD },
      asResponse: true,
    });
    const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
    const request = new Request("https://example.com/order", { headers: { Cookie: cookie } });
    expect((await authorizeStaff(request, testEnv)).ok).toBe(true);

    const replacementEnv = {
      ...testEnv,
      RETIRE_USER_ID: oldId,
      STAFF_PASSWORD: "replacement-password-1234",
    };
    const newId = await runProvisioning(replacementEnv);
    expect(newId).not.toBe(oldId);
    expect(await runProvisioning(replacementEnv)).toBe(newId);
    expect((await authorizeStaff(request, testEnv)).ok).toBe(false);
    const old = await testEnv.DB.prepare("SELECT username, is_active FROM user WHERE id = ?")
      .bind(oldId)
      .first<{ username: string; is_active: number }>();
    expect(old?.is_active).toBe(0);
    expect(old?.username).toMatch(/^retired_/);
    for (const table of ["session", "account"]) {
      const row = await testEnv.DB.prepare(
        `SELECT count(*) AS count FROM ${table} WHERE user_id = ?`,
      )
        .bind(oldId)
        .first<{ count: number }>();
      expect(row?.count).toBe(0);
    }
    const replacementLogin = await createAuth(testEnv).api.signInUsername({
      body: { username: testEnv.STAFF_USERNAME, password: replacementEnv.STAFF_PASSWORD },
      asResponse: true,
    });
    expect(replacementLogin.status).toBe(200);
  }, 15_000);

  it("keeps the old account usable when replacement input is rejected", async () => {
    const oldId = await runProvisioning(testEnv);
    await expect(
      runProvisioning({
        ...testEnv,
        RETIRE_USER_ID: oldId,
        STAFF_PASSWORD: "x".repeat(129),
      }),
    ).rejects.toThrow("Missing or invalid provisioning credentials");
    const old = await testEnv.DB.prepare("SELECT is_active FROM user WHERE id = ?")
      .bind(oldId)
      .first<{ is_active: number }>();
    expect(old?.is_active).toBe(1);
    const login = await createAuth(testEnv).api.signInUsername({
      body: { username: testEnv.STAFF_USERNAME, password: testEnv.STAFF_PASSWORD },
      asResponse: true,
    });
    expect(login.status).toBe(200);
  });
});
