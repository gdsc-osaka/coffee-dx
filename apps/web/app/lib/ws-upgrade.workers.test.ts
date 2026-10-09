/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "./auth.server";
import { handleStaffWebSocketUpgrade } from "./ws-upgrade.server";
import { runProvisioning } from "../../provision-worker";

const testEnv = {
  ...env,
  BETTER_AUTH_SECRET: "websocket-test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "https://example.com",
  STAFF_USERNAME: "socketstaff",
  STAFF_PASSWORD: "test-password-1234",
  STAFF_DISPLAY_NAME: "Socket Staff",
} as Env & {
  TEST_MIGRATIONS: D1Migration[];
  STAFF_USERNAME: string;
  STAFF_PASSWORD: string;
  STAFF_DISPLAY_NAME: string;
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

describe("WebSocket authorization boundary", () => {
  it("rejects spoofed internal headers without a session and rejects direct DO access", async () => {
    const request = new Request("https://example.com/ws?eventId=2026-04-18", {
      headers: {
        Upgrade: "websocket",
        "x-event-id": "2026-04-18",
        "x-auth-user-id": "forged",
        "x-auth-session-id": "forged",
        "x-auth-deadline": String(Date.now() + 10_000_000),
      },
    });
    expect((await handleStaffWebSocketUpgrade(request, testEnv)).status).toBe(401);
    const stub = testEnv.ORDER_DO.get(testEnv.ORDER_DO.idFromName("event-2026-04-18"));
    const direct = await stub.fetch(
      new Request("https://example.com/ws", {
        headers: { Upgrade: "websocket", "x-event-id": "2026-04-18" },
      }),
    );
    expect(direct.status).toBe(401);
  });

  it("overwrites spoofed headers, sends deadline first, and rejects disabled users", async () => {
    const userId = await runProvisioning(testEnv);
    const login = await createAuth(testEnv).api.signInUsername({
      body: { username: testEnv.STAFF_USERNAME, password: testEnv.STAFF_PASSWORD },
      asResponse: true,
    });
    const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
    const request = new Request("https://example.com/ws?eventId=2026-04-18", {
      headers: {
        Upgrade: "websocket",
        Cookie: cookie,
        "x-event-id": "wrong-date",
        "x-auth-user-id": "forged",
        "x-auth-session-id": "forged",
        "x-auth-deadline": String(Date.now() + 10_000_000),
      },
    });
    const connectedAt = Date.now();
    const response = await handleStaffWebSocketUpgrade(request, testEnv);
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    const firstMessage = new Promise<{ type: string; authDeadline: number; serverTime: number }>(
      (resolve) => {
        socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)));
      },
    );
    socket.accept();
    const message = await firstMessage;
    socket.close();
    expect(message.type).toBe("auth-deadline");
    expect(message.authDeadline).toBeGreaterThan(connectedAt);
    expect(message.authDeadline - message.serverTime).toBeLessThanOrEqual(300_000);

    await testEnv.DB.prepare("UPDATE user SET is_active = 0 WHERE id = ?").bind(userId).run();
    expect((await handleStaffWebSocketUpgrade(request, testEnv)).status).toBe(403);
  });

  it("closes a DO socket with 4001 at the internal deadline", async () => {
    const stub = testEnv.ORDER_DO.get(testEnv.ORDER_DO.idFromName("event-2026-04-18"));
    const response = await stub.fetch(
      new Request("https://example.com/ws", {
        headers: {
          Upgrade: "websocket",
          "x-event-id": "2026-04-18",
          "x-auth-user-id": "test-staff",
          "x-auth-session-id": "test-session",
          "x-auth-deadline": String(Date.now() + 150),
        },
      }),
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    const closed = new Promise<CloseEvent>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event as CloseEvent)),
    );
    socket.accept();
    const event = await closed;
    expect(event.code).toBe(4001);
  });
});
