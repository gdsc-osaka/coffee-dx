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

// テストではタイマー UI を有効にして検証する。本番では一時的に無効化中。
vi.mock("./constants", () => ({
  TIMER_FEATURE_ENABLED: true,
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
  timerStartedAt: string | null;
  laneIndex: number;
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
  timerStartedAt?: string | null;
  laneIndex?: number;
}): BrewUnit {
  return {
    batchId: overrides.batchId ?? "b1",
    menuItemId: "menu-1",
    menuItemName: "アメリカーノ",
    orderItemId: overrides.orderItemId ?? null,
    targetDurationSec: overrides.targetDurationSec ?? null,
    timerStartedAt: overrides.timerStartedAt ?? null,
    laneIndex: overrides.laneIndex ?? 0,
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

    // 抽出レーン section にスワイプ完了・長押し取消の操作子が出る
    const lanesSection = await waitFor(() => {
      const section = screen.getByRole("region", { name: "抽出レーン" });
      expect(within(section).getByRole("button", { name: /スワイプで完了/ })).toBeInTheDocument();
      return section;
    });

    expect(
      within(lanesSection).getByRole("button", { name: /取消 \(1秒長押し\)/ }),
    ).toBeInTheDocument();
    // 固定 3 レーン枠が常に表示される
    expect(within(lanesSection).getByText(/レーン 1$/)).toBeInTheDocument();
    expect(within(lanesSection).getByText(/レーン 2$/)).toBeInTheDocument();
    expect(within(lanesSection).getByText(/レーン 3$/)).toBeInTheDocument();
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

  it("BREW_UNIT_DELETED で完了 / 取消 ボタンが消えるが、レーン枠自体は idle として残る", async () => {
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

    const lanesSection = screen.getByRole("region", { name: "抽出レーン" });
    await waitFor(() => {
      expect(
        within(lanesSection).queryByRole("button", { name: /スワイプで完了/ }),
      ).not.toBeInTheDocument();
      expect(
        within(lanesSection).queryByRole("button", { name: /取消 \(1秒長押し\)/ }),
      ).not.toBeInTheDocument();
    });
    // レーン枠は固定 3 個で常時表示される（レーン 1〜3 の見出し）
    expect(within(lanesSection).getByText(/レーン 1$/)).toBeInTheDocument();
    expect(within(lanesSection).getByText(/レーン 2$/)).toBeInTheDocument();
    expect(within(lanesSection).getByText(/レーン 3$/)).toBeInTheDocument();
  });

  it("初期表示で 3 つのレーン枠が出ており、メニュー選択前は「抽出開始」が disabled", async () => {
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
    expect(within(lanesSection).getByText(/レーン 1$/)).toBeInTheDocument();
    expect(within(lanesSection).getByText(/レーン 2$/)).toBeInTheDocument();
    expect(within(lanesSection).getByText(/レーン 3$/)).toBeInTheDocument();
    // 固定 3 レーンなので「+ 追加」「× 削除」UI は出ない
    expect(
      within(lanesSection).queryByRole("button", { name: /レーン追加/ }),
    ).not.toBeInTheDocument();
    expect(
      within(lanesSection).queryByRole("button", { name: "このレーンを削除" }),
    ).not.toBeInTheDocument();

    // メニュー未選択 / タイマー 0 のときは抽出開始 disabled
    const startButtons = within(lanesSection).getAllByRole("button", { name: "▶ 抽出開始" });
    expect(startButtons[0]).toBeDisabled();

    // メニュー選択しただけではまだ disabled（タイマーが 0 なので）
    const americanos = within(lanesSection).getAllByRole("button", { name: "アメリカーノ" });
    fireEvent.click(americanos[0]);
    expect(within(lanesSection).getAllByRole("button", { name: "▶ 抽出開始" })[0]).toBeDisabled();

    // タイマーを +1分 → enabled
    fireEvent.click(within(lanesSection).getAllByRole("button", { name: "+1分" })[0]);
    expect(within(lanesSection).getAllByRole("button", { name: "▶ 抽出開始" })[0]).toBeEnabled();
  });

  it("brewing バッチ受信時にタイマー UI と完了 / 取消 操作子が同時に出る（タイマー未設定でも完了可能）", async () => {
    renderDrip();
    const ws = MockWebSocket.instances[0];

    await act(async () => {
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [],
        brewUnits: [
          buildBrewUnit({
            id: "u1",
            status: "brewing",
            // タイマー未設定で抽出開始したケース
            targetDurationSec: null,
            timerStartedAt: null,
          }),
        ],
      });
    });

    const lanesSection = await waitFor(() => screen.getByRole("region", { name: "抽出レーン" }));
    // タイマー UI が unset 表示で出る（▶ タイマー開始 ボタン）
    expect(
      within(lanesSection).getByRole("button", { name: "▶ タイマー開始" }),
    ).toBeInTheDocument();
    // 完了スワイプと取消長押しはタイマー状態に関係なく常時表示
    expect(
      within(lanesSection).getByRole("button", { name: /スワイプで完了/ }),
    ).toBeInTheDocument();
    expect(
      within(lanesSection).getByRole("button", { name: /取消 \(1秒長押し\)/ }),
    ).toBeInTheDocument();
  });

  it("brewing バッチは batch.laneIndex のスロットへ表示される（端末間で同じ位置）", async () => {
    renderDrip();
    const ws = MockWebSocket.instances[0];

    // batch1 は laneIndex=2 (= レーン 3)
    await act(async () => {
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [],
        brewUnits: [buildBrewUnit({ id: "u1", status: "brewing", batchId: "b1", laneIndex: 2 })],
      });
    });

    const lanesSection = await waitFor(() => screen.getByRole("region", { name: "抽出レーン" }));

    // レーン 3 (=index 2) に active 表示が出ている
    const lane3Header = within(lanesSection).getByText(/レーン 3$/);
    const lane3 = lane3Header.closest("div")!.parentElement!;
    expect(within(lane3).getByText("抽出中")).toBeInTheDocument();

    // レーン 1, 2 はまだ idle
    const lane1Header = within(lanesSection).getByText(/レーン 1$/);
    const lane1 = lane1Header.closest("div")!.parentElement!;
    expect(within(lane1).getByRole("button", { name: "▶ 抽出開始" })).toBeInTheDocument();
  });
});
