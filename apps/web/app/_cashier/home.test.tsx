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

import CashierHome from "./home";

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
      brewUnits: Array<{
        id: string;
        batchId: string;
        menuItemId: string;
        menuItemName: string;
        orderItemId: string | null;
        status: "brewing" | "ready";
        businessDate: string;
        createdAt: string;
        updatedAt: string;
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

const ts = "2026-04-18 12:00:00";

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
    createdAt: ts,
    updatedAt: ts,
    items: [
      {
        id: `${id}-item`,
        orderId: id,
        menuItemId: "menu-1",
        quantity: 1,
        name: "アメリカーノ",
        createdAt: ts,
        updatedAt: ts,
      },
    ],
  };
}

function buildBrewUnit(overrides: {
  id: string;
  status: "brewing" | "ready";
  orderItemId: string | null;
  batchId?: string;
}) {
  return {
    batchId: overrides.batchId ?? "b1",
    menuItemId: "menu-1",
    menuItemName: "アメリカーノ",
    businessDate: "2026-04-18",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe("CashierHome", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    useActionDataMock.mockReturnValue(undefined);
    useNavigationMock.mockReturnValue({ state: "idle", formData: undefined });
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  it("SNAPSHOT受信後に各 status セクションが描画され、ready の注文にだけ 完了 ボタンが出る", async () => {
    render(<CashierHome {...({ loaderData: { eventId: "2026-04-18" } } as any)} />);

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
          buildOrder({ id: "o3", orderNumber: 3, status: "ready" }),
        ],
        // ready 注文 o3 の 1 杯分は紐付き ready unit として表現する
        brewUnits: [
          buildBrewUnit({ id: "u3", status: "ready", orderItemId: "o3-item" }),
        ],
      });
    });

    await waitFor(() => {
      // serverStatus === "ready" の注文に対してのみ 完了 ボタンが出る
      expect(screen.getAllByRole("button", { name: "完了" })).toHaveLength(1);
    });

    // セクション見出しは常時描画される
    expect(screen.getByRole("heading", { name: /提供待ち/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ドリップ中/ })).toBeInTheDocument();
    // 旧 UI の "作成待ち" は存在しない (現行は "待機中")
    expect(screen.queryByRole("heading", { name: /作成待ち/ })).not.toBeInTheDocument();

    const buttons = screen.getAllByRole("button", { name: "完了" });
    expect(buttons[0]).toBeEnabled();
  });

  it("ORDER_UPDATED で completed になった注文を一覧から取り除く", async () => {
    render(<CashierHome {...({ loaderData: { eventId: "2026-04-18" } } as any)} />);

    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [buildOrder({ id: "o10", orderNumber: 10, status: "ready" })],
        brewUnits: [
          buildBrewUnit({ id: "u10", status: "ready", orderItemId: "o10-item" }),
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "完了" })).toHaveLength(1);
    });

    await act(async () => {
      ws.emitMessage({ type: "ORDER_UPDATED", orderId: "o10", status: "completed" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "完了" })).not.toBeInTheDocument();
      expect(screen.getByText("進行中の注文はありません")).toBeInTheDocument();
    });
  });
});
