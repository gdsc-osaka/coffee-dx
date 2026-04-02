import { createRequestHandler } from "@react-router/cloudflare";
import * as build from "virtual:react-router/server-build";

export interface Env {
  // D1
  // DB: D1Database;

  // Durable Objects
  // ORDER_DO: DurableObjectNamespace;
}

const requestHandler = createRequestHandler(build);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
