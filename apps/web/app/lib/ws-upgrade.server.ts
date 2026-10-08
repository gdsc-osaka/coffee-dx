import { authorizeStaff } from "./auth.server";
import { isValidEventId } from "./order-do";

export async function handleStaffWebSocketUpgrade(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const eventId = new URL(request.url).searchParams.get("eventId");
  if (!eventId || !isValidEventId(eventId)) {
    return new Response("Invalid or missing eventId. Expected format: YYYY-MM-DD", { status: 400 });
  }

  const authorization = await authorizeStaff(request, env);
  if (!authorization.ok) {
    return new Response(authorization.status === 401 ? "Unauthorized" : "Forbidden", {
      status: authorization.status,
    });
  }

  const deadline = Math.min(authorization.user.expiresAt.getTime(), Date.now() + 300_000);
  if (deadline <= Date.now()) return new Response("Unauthorized", { status: 401 });

  const id = env.ORDER_DO.idFromName(`event-${eventId}`);
  const stub = env.ORDER_DO.get(id);
  // Overwrite all client supplied internal fields before crossing the DO boundary.
  const forwarded = new Request(request);
  forwarded.headers.set("x-event-id", eventId);
  forwarded.headers.set("x-auth-user-id", authorization.user.userId);
  forwarded.headers.set("x-auth-session-id", authorization.user.sessionId);
  forwarded.headers.set("x-auth-deadline", String(deadline));
  return stub.fetch(forwarded);
}
