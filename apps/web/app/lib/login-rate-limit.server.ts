const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

async function hashKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Count attempts atomically in D1 so all Worker instances share one limit. */
export async function checkLoginRateLimit(
  request: Request,
  env: Env,
  username: string,
): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const keys = [
    await hashKey(`ip:${ip}`),
    await hashKey(`username:${username.trim().toLowerCase().slice(0, 128)}`),
  ];
  const now = Date.now();
  const resetAt = now + WINDOW_MS;

  // Bound storage growth from one-off usernames without deleting active windows.
  await env.DB.prepare(
    `DELETE FROM auth_login_attempts WHERE key IN (
       SELECT key FROM auth_login_attempts WHERE reset_at <= ? LIMIT 100
     )`,
  )
    .bind(now)
    .run();

  for (const key of keys) {
    const row = await env.DB.prepare(
      `INSERT INTO auth_login_attempts (key, count, reset_at)
       VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
       RETURNING count, reset_at AS resetAt`,
    )
      .bind(key, resetAt, now, now)
      .first<{ count: number; resetAt: number }>();
    if (!row) throw new Error("Unable to record login attempt");
    if (row.count > MAX_ATTEMPTS) {
      const retryAfter = Math.max(1, Math.ceil((row.resetAt - now) / 1000));
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": String(retryAfter), "X-Retry-After": String(retryAfter) },
      });
    }
  }
  return null;
}
