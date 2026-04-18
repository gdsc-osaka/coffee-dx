import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useActionDataMock, useNavigationMock } = vi.hoisted(() => ({
  useActionDataMock: vi.fn(),
  useNavigationMock: vi.fn(),
}));

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
  useActionData: useActionDataMock,
  useNavigation: useNavigationMock,
}));

import DripHome from "./home";

type ServerMessage =
  | {
      type: "SNAPSHOT";
      orders: Array<{
        id: string;
        orderNumber: number;
        status: "pending" | "brewing" | "ready" | "completed" | "cancelled";
        createdAt: string;
        updatedAt: string;
        items: Array<{
          id: string;
          orderId: string;
          menuItemId: string;
          quantity: number;
          name?: string;
          createdAt: string;
          updatedAt: string;
        }>;
      }>;
    }
  | { type: "ORDER_CREATED"; order: unknown }
  | { type: "ORDER_UPDATED"; orderId: string; status: string };

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.onclose?.({} as CloseEvent);
  }

  emitOpen() {
    this.onopen?.({} as Event);
  }

  emitMessage(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

function buildOrder({
  id,
  orderNumber,
  status,
}: {
  id: string;
  orderNumber: number;
  status: "pending" | "brewing" | "ready";
}) {
  return {
    id,
    orderNumber,
    status,
    createdAt: "2026-04-18 12:00:00",
    updatedAt: "2026-04-18 12:00:00",
    items: [
      {
        id: `${id}-item`,
        orderId: id,
        menuItemId: "menu-1",
        quantity: 1,
        name: "アメリカーノ",
        createdAt: "2026-04-18 12:00:00",
        updatedAt: "2026-04-18 12:00:00",
      },
    ],
  };
}

describe("DripHome", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    useActionDataMock.mockReturnValue(undefined);
    useNavigationMock.mockReturnValue({ state: "idle", formData: undefined });
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  it("SNAPSHOT受信後に pending / brewing を表示し、状態ごとのボタンを出す", async () => {
    render(<DripHome {...({ loaderData: { eventId: "2026-04-18" } } as any)} />);

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    expect(ws.url).toContain("/ws?eventId=2026-04-18");

    await act(async () => {
      ws.emitOpen();
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [
          buildOrder({ id: "o1", orderNumber: 1, status: "pending" }),
          buildOrder({ id: "o2", orderNumber: 2, status: "brewing" }),
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
      expect(screen.getByText("#2")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: /未着手/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ドリップ中/ })).toBeInTheDocument();

    const startButtons = screen.getAllByRole("button", { name: "開始" });
    expect(startButtons).toHaveLength(1);
    expect(startButtons[0]).toBeEnabled();

    const completeButtons = screen.getAllByRole("button", { name: "完成" });
    expect(completeButtons).toHaveLength(1);
    expect(completeButtons[0]).toBeEnabled();
  });

  it("ORDER_UPDATED で ready になった注文を一覧から取り除く", async () => {
    render(<DripHome {...({ loaderData: { eventId: "2026-04-18" } } as any)} />);

    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [buildOrder({ id: "o10", orderNumber: 10, status: "brewing" })],
      });
    });

    await waitFor(() => {
      expect(screen.getByText("#10")).toBeInTheDocument();
    });

    await act(async () => {
      ws.emitMessage({ type: "ORDER_UPDATED", orderId: "o10", status: "ready" });
    });

    await waitFor(() => {
      expect(screen.queryByText("#10")).not.toBeInTheDocument();
      expect(screen.getByText("進行中の注文はありません")).toBeInTheDocument();
    });
  });
});
