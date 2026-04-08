import { createRequestHandler } from "react-router";
export { OrderDurableObject } from "./app/durable-objects/OrderDO";

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
      const eventId = url.searchParams.get("eventId");
      if (!eventId) {
        return new Response("eventId is required", { status: 400 });
      }
      const id = env.ORDER_DO.idFromName(`event-${eventId}`);
      const stub = env.ORDER_DO.get(id);
      return stub.fetch(request);
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
