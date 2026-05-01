import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useActionDataMock, useNavigationMock, useSubmitMock } = vi.hoisted(() => ({
  useActionDataMock: vi.fn(),
  useNavigationMock: vi.fn(),
  useSubmitMock: vi.fn(),
}));

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
  useActionData: useActionDataMock,
  useNavigation: useNavigationMock,
  useSubmit: useSubmitMock,
}));

import DripHome from "./home";

type BrewUnit = {
  id: string;
  batchId: string;
  menuItemId: string;
  menuItemName: string;
  orderItemId: string | null;
  status: "brewing" | "ready";
  targetDurationSec: number | null;
  businessDate: string;
  createdAt: string;
  updatedAt: string;
};

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
      brewUnits: BrewUnit[];
    }
  | { type: "ORDER_CREATED"; order: unknown }
  | { type: "ORDER_UPDATED"; orderId: string; status: string }
  | { type: "BREW_UNITS_CREATED"; brewUnits: BrewUnit[] }
  | { type: "BREW_UNIT_UPDATED"; brewUnit: BrewUnit }
  | { type: "BREW_UNIT_DELETED"; brewUnitId: string };

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

function buildOrder(id: string, orderNumber: number, menuItemId: string, quantity: number) {
  return {
    id,
    orderNumber,
    status: "pending" as const,
    createdAt: ts,
    updatedAt: ts,
    items: [
      {
        id: `${id}-item`,
        orderId: id,
        menuItemId,
        quantity,
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
  orderItemId?: string | null;
  batchId?: string;
  targetDurationSec?: number | null;
}): BrewUnit {
  return {
    batchId: overrides.batchId ?? "b1",
    menuItemId: "menu-1",
    menuItemName: "アメリカーノ",
    orderItemId: overrides.orderItemId ?? null,
    targetDurationSec: overrides.targetDurationSec ?? null,
    businessDate: "2026-04-18",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

const renderDrip = () =>
  render(
    <DripHome
      {...({
        loaderData: {
          eventId: "2026-04-18",
          menus: [{ id: "menu-1", name: "アメリカーノ" }],
        },
      } as any)}
    />,
  );

describe("DripHome", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    useActionDataMock.mockReturnValue(undefined);
    useNavigationMock.mockReturnValue({ state: "idle", formData: undefined });
    useSubmitMock.mockReturnValue(vi.fn());
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  it("SNAPSHOT 受信後に brewing バッチがアクティブレーンとして表示される（完了 / 取消 ボタン付き）", async () => {
    renderDrip();

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    expect(ws.url).toContain("/ws?eventId=2026-04-18");

    await act(async () => {
      ws.emitOpen();
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [buildOrder("o1", 1, "menu-1", 2)],
        brewUnits: [buildBrewUnit({ id: "u1", status: "brewing" })],
      });
    });

    // 抽出レーン section にメニュー名と「スワイプで完了 / 1秒長押し取消」操作子が出る
    const lanesSection = await waitFor(() => {
      const section = screen.getByRole("region", { name: "抽出レーン" });
      expect(within(section).getByText("アメリカーノ")).toBeInTheDocument();
      return section;
    });

    expect(
      within(lanesSection).getByRole("button", { name: /スワイプで完了/ }),
    ).toBeInTheDocument();
    expect(
      within(lanesSection).getByRole("button", { name: /取消 \(1秒長押し\)/ }),
    ).toBeInTheDocument();
  });

  it("ProductionDashboard に余剰削除ボタンが ready 余剰時のみ出る", async () => {
    renderDrip();
    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [buildOrder("o1", 1, "menu-1", 1)],
        brewUnits: [buildBrewUnit({ id: "u-linked", status: "ready", orderItemId: "o1-item" })],
      });
    });

    const dashboard = await waitFor(() => screen.getByRole("region", { name: "生産状況" }));

    expect(within(dashboard).queryByTitle("余剰を1件減らす")).not.toBeInTheDocument();

    await act(async () => {
      ws.emitMessage({
        type: "BREW_UNIT_UPDATED",
        brewUnit: buildBrewUnit({ id: "u-surplus", status: "ready", orderItemId: null }),
      });
    });

    await waitFor(() => {
      expect(within(dashboard).getByTitle("余剰を1件減らす")).toBeEnabled();
    });
  });

  it("BREW_UNIT_DELETED でアクティブレーンが消滅し、完了 / 取消 ボタンも消える", async () => {
    renderDrip();
    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [],
        brewUnits: [buildBrewUnit({ id: "u1", status: "brewing" })],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /スワイプで完了/ })).toBeInTheDocument();
    });

    await act(async () => {
      ws.emitMessage({ type: "BREW_UNIT_DELETED", brewUnitId: "u1" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /スワイプで完了/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /取消 \(1秒長押し\)/ })).not.toBeInTheDocument();
    });
  });

  it("「+ レーン追加」でアイドルレーンが現れ、メニューと杯数を選んで「抽出開始」できる", async () => {
    renderDrip();
    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [],
        brewUnits: [],
      });
    });

    const lanesSection = await waitFor(() => screen.getByRole("region", { name: "抽出レーン" }));
    // 初期はアクティブレーンなし、アイドルもなし
    expect(within(lanesSection).queryByText(/レーン 1$/)).not.toBeInTheDocument();

    // レーン追加
    fireEvent.click(within(lanesSection).getByRole("button", { name: /レーン追加/ }));
    expect(within(lanesSection).getByText(/レーン 1$/)).toBeInTheDocument();

    // メニュー選択
    fireEvent.click(within(lanesSection).getByRole("button", { name: "アメリカーノ" }));

    // 抽出開始 → タイマー設定中に遷移
    fireEvent.click(within(lanesSection).getByRole("button", { name: "▶ 抽出開始" }));
    expect(within(lanesSection).getByText("合計")).toBeInTheDocument();
  });
});
