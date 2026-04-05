import { defineConfig } from "drizzle-kit";

/**
 * SQL は `drizzle/migrations/` に出力（wrangler.toml の migrations_dir と一致）
 * 生成: pnpm run db:generate
 *
 * 注意: drizzle-kit が FK 先より子テーブルを先に出力することがある。
 * その場合は `0000_*.sql` の CREATE TABLE 順を手で直してから `migrate:local` で確認すること。
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
});
