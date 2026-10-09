/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as orderLayout from "../_order";
import * as orderHome from "../_order/home";
import * as dripLayout from "../_drip";
import * as dripHome from "../_drip/home";
import * as drip2Layout from "../_drip2";
import * as drip2Home from "../_drip2/home";
import * as cashierLayout from "../_cashier";
import * as cashierHome from "../_cashier/home";
import * as menuItems from "../_cashier/menu-items";
import * as mobileCheckout from "../_cashier/mobile-order-checkout";
import * as ordersHistory from "../_cashier/orders-history";
import * as leftoverOrders from "../_cashier/leftover-orders";

const testEnv = {
  ...env,
  BETTER_AUTH_SECRET: "routes-test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "https://example.com",
} as Env & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

type Handler = (args: never) => Promise<unknown>;

const pages: Array<[string, Handler, Handler?]> = [
  ["/order", orderLayout.loader as Handler],
  ["/order", orderHome.loader as Handler, orderHome.action as Handler],
  ["/order/menu-items", menuItems.loader as Handler, menuItems.action as Handler],
  ["/order/mobile-checkout", mobileCheckout.loader as Handler, mobileCheckout.action as Handler],
  ["/drip", dripLayout.loader as Handler],
  ["/drip", dripHome.loader as Handler, dripHome.action as Handler],
  ["/drip2", drip2Layout.loader as Handler],
  ["/drip2", drip2Home.loader as Handler, drip2Home.action as Handler],
  ["/cashier", cashierLayout.loader as Handler],
  ["/cashier", cashierHome.loader as Handler, cashierHome.action as Handler],
];

describe("all staff route handlers", () => {
  for (const [path, loader, action] of pages) {
    it(`${path} loader redirects unauthenticated visitors`, async () => {
      const request = new Request(`https://example.com${path}?from=test`);
      const invoke = loader as (args: unknown) => Promise<unknown>;
      await expect(
        invoke({ request, context: { cloudflare: { env: testEnv } } }),
      ).rejects.toMatchObject({
        status: 302,
      });
    });
    if (action) {
      it(`${path} action redirects before mutation`, async () => {
        const request = new Request(`https://example.com${path}`, { method: "POST" });
        const invoke = action as (args: unknown) => Promise<unknown>;
        await expect(
          invoke({ request, context: { cloudflare: { env: testEnv } } }),
        ).rejects.toMatchObject({ status: 302 });
      });
    }
  }

  for (const [path, loader] of [
    ["/cashier/orders-history", ordersHistory.loader],
    ["/cashier/leftover-orders", leftoverOrders.loader],
  ] as const) {
    it(`${path} resource loader returns 401`, async () => {
      const request = new Request(`https://example.com${path}`);
      const invoke = loader as (args: unknown) => Promise<unknown>;
      await expect(
        invoke({ request, context: { cloudflare: { env: testEnv } } }),
      ).rejects.toMatchObject({
        status: 401,
      });
    });
  }
});
