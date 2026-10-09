import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSocketAuthDeadline } from "./ws-auth-client";

afterEach(() => vi.useRealTimers());

describe("WebSocket client reauthentication", () => {
  it("closes when the first message is not a deadline", () => {
    const socket = { readyState: WebSocket.OPEN, close: vi.fn() } as unknown as WebSocket;
    const auth = createWebSocketAuthDeadline(socket);
    expect(auth.accept({ type: "SNAPSHOT" })).toBe(false);
    expect(socket.close).toHaveBeenCalledWith(4001, "Authentication expired");
    auth.dispose();
  });

  it("uses the server's duration and closes at its deadline", () => {
    vi.useFakeTimers();
    const socket = { readyState: WebSocket.OPEN, close: vi.fn() } as unknown as WebSocket;
    const auth = createWebSocketAuthDeadline(socket);
    expect(auth.accept({ type: "auth-deadline", serverTime: 1_000, authDeadline: 2_000 })).toBe(
      false,
    );
    expect(auth.accept({ type: "SNAPSHOT" })).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(socket.close).toHaveBeenCalledWith(4001, "Authentication expired");
    expect(auth.accept({ type: "ORDER_CREATED" })).toBe(false);
    auth.dispose();
  });
});
