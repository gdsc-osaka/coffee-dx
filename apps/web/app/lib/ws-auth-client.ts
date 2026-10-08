/** Enforce the server's reauthentication deadline using a monotonic client clock. */
export function createWebSocketAuthDeadline(socket: WebSocket) {
  let accepted = false;
  let deadlineAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const closeExpired = () => {
    if (socket.readyState === WebSocket.OPEN) socket.close(4001, "Authentication expired");
  };

  return {
    accept(message: unknown): boolean {
      if (!accepted) {
        if (typeof message !== "object" || message === null) {
          closeExpired();
          return false;
        }
        const value = message as Record<string, unknown>;
        const duration = Number(value.authDeadline) - Number(value.serverTime);
        if (
          value.type !== "auth-deadline" ||
          !Number.isSafeInteger(value.authDeadline) ||
          !Number.isSafeInteger(value.serverTime) ||
          !Number.isFinite(duration) ||
          duration <= 0 ||
          duration > 300_000
        ) {
          closeExpired();
          return false;
        }
        accepted = true;
        deadlineAt = performance.now() + duration;
        timer = setTimeout(closeExpired, duration);
        return false;
      }
      if (performance.now() >= deadlineAt) {
        closeExpired();
        return false;
      }
      return true;
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
