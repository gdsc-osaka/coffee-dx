import { createRequestHandler } from "react-router";
export { OrderDurableObject } from "./app/durable-objects/OrderDO";

import { handleStaffWebSocketUpgrade } from "./app/lib/ws-upgrade.server";

// Wrangler の本番バンドル（esbuild）では Vite が import.meta.env を注入しない
const mode = (import.meta as { env?: { MODE?: string } }).env?.MODE ?? "production";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  mode,
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return handleStaffWebSocketUpgrade(request, env);
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
