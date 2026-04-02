import { createRequestHandler } from "react-router";
import type { ServerBuild } from "react-router";

export interface Env {
  // D1
  // DB: D1Database;
  // Durable Objects
  // ORDER_DO: DurableObjectNamespace;
}

// build/server/index.js は react-router build 後に生成される
// @ts-ignore
import * as build from "../build/server/index.js";

const requestHandler = createRequestHandler(build as unknown as ServerBuild);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
