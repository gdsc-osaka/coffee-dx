/** JST の YYYY-MM-DD をイベントID として使う */
export function getBusinessDate(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function isValidEventId(eventId: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(eventId);
}

export function getOrderDOStub(env: Env, eventId: string): DurableObjectStub {
  if (!isValidEventId(eventId)) {
    throw new Error(`Invalid eventId format: ${eventId}`);
  }
  const id = env.ORDER_DO.idFromName(`event-${eventId}`);
  return env.ORDER_DO.get(id);
}

export async function callOrderDO(
  stub: DurableObjectStub,
  path: string,
  body?: unknown,
): Promise<void> {
  const res = await stub.fetch(
    new Request(`https://do${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  if (!res.ok) {
    throw new Error(`DO error ${res.status}: ${await res.text()}`);
  }
}
