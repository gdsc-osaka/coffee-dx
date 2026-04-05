import { createRequestHandler } from "react-router";

// Wrangler の本番バンドル（esbuild）では Vite が import.meta.env を注入しない
const mode =
  (import.meta as { env?: { MODE?: string } }).env?.MODE ?? "production";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  mode,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
