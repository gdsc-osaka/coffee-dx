import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle/migrations"));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    resolve: {
      alias: {
        "~": path.resolve(__dirname, "app"),
        "~/db": path.resolve(__dirname, "db"),
      },
    },
    test: {
      globals: true,
      include: ["app/**/*.workers.{test,spec}.{ts,tsx}"],
    },
  };
});
