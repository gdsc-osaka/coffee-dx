// テスト環境専用のバインディング型拡張
// vitest.workers.config.ts で miniflare.bindings に渡している TEST_MIGRATIONS を Env に追加
interface Env {
  TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
}
