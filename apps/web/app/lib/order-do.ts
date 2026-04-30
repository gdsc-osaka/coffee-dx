/** JST の YYYY-MM-DD をイベントID として使う */
export function getBusinessDate(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function isValidEventId(eventId: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventId)) {
    return false;
  }
  const date = new Date(eventId);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  // 存在しない日付（例: 2026-02-30等）がJSエンジンにより自動補正されて別の日付になるのを防ぐ
  return date.toISOString().startsWith(eventId);
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
  options?: { method?: string; body?: unknown },
): Promise<void> {
  const method = options?.method ?? "POST";
  const body = options?.body;
  const res = await stub.fetch(
    new Request(new URL(path, "https://do").toString(), {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  if (!res.ok) {
    throw new Error(`DO error ${res.status}: ${await res.text()}`);
  }
}
