import { render, screen, waitFor, within } from "@testing-library/react";
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

type BrewUnit = {
  id: string;
  batchId: string;
  menuItemId: string;
  menuItemName: string;
  orderItemId: string | null;
  status: "brewing" | "ready";
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
}): BrewUnit {
  return {
    batchId: overrides.batchId ?? "b1",
    menuItemId: "menu-1",
    menuItemName: "アメリカーノ",
    orderItemId: overrides.orderItemId ?? null,
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
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  it("SNAPSHOT 受信後にメニューセクションが表示され、抽出中バッチに 完了/取消し ボタンと新規バッチ用の 開始 ボタンが出る", async () => {
    renderDrip();

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    expect(ws.url).toContain("/ws?eventId=2026-04-18");

    await act(async () => {
      ws.emitOpen();
      ws.emitMessage({
        type: "SNAPSHOT",
        // 注文 1件 (アメリカーノ × 2 杯)
        orders: [buildOrder("o1", 1, "menu-1", 2)],
        // 抽出中 1 杯のバッチ
        brewUnits: [buildBrewUnit({ id: "u1", status: "brewing" })],
      });
    });

    // メニュー単位のセクションが描画される
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "アメリカーノ" })).toBeInTheDocument();
    });

    const section = screen
      .getByRole("heading", { name: "アメリカーノ" })
      .closest("section") as HTMLElement;
    expect(section).toBeTruthy();

    // 集計テキストがセクション内に出る (注文 2 / 抽出中 1 / 完成 0)
    expect(section).toHaveTextContent(/注文/);
    expect(section).toHaveTextContent(/抽出中/);
    expect(section).toHaveTextContent(/完成/);

    // 抽出中バッチに対する 完了 / 取消し ボタンが出る
    expect(within(section).getByRole("button", { name: "完了" })).toBeEnabled();
    expect(within(section).getByRole("button", { name: "取消し" })).toBeEnabled();

    // 新規バッチ開始用の杯数選択 (1/2/3) と 開始 ボタン
    expect(within(section).getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "2" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "3" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "開始" })).toBeEnabled();
  });

  it("ready 余剰がある時に余剰削除ボタンが出る (なければ出ない)", async () => {
    renderDrip();
    const ws = MockWebSocket.instances[0];

    // まず 余剰なし (orderItemId 紐付きの ready のみ) で開く
    await act(async () => {
      ws.emitMessage({
        type: "SNAPSHOT",
        orders: [buildOrder("o1", 1, "menu-1", 1)],
        brewUnits: [
          buildBrewUnit({ id: "u-linked", status: "ready", orderItemId: "o1-item" }),
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "アメリカーノ" })).toBeInTheDocument();
    });

    // 余剰なしの状態では - ボタンは出ない
    expect(screen.queryByTitle("余剰を1件減らす")).not.toBeInTheDocument();

    // 余剰 (ready かつ orderItemId=null) のユニットを追加
    await act(async () => {
      ws.emitMessage({
        type: "BREW_UNIT_UPDATED",
        brewUnit: buildBrewUnit({ id: "u-surplus", status: "ready", orderItemId: null }),
      });
    });

    // 余剰削除ボタンが出現する
    await waitFor(() => {
      expect(screen.getByTitle("余剰を1件減らす")).toBeEnabled();
    });
  });

  it("BREW_UNIT_DELETED で抽出中バッチが消えると 完了/取消し ボタンも消える", async () => {
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
      expect(screen.getByRole("button", { name: "完了" })).toBeInTheDocument();
    });

    await act(async () => {
      ws.emitMessage({ type: "BREW_UNIT_DELETED", brewUnitId: "u1" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "完了" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "取消し" })).not.toBeInTheDocument();
    });

    // 開始 ボタンはバッチの有無にかかわらず常時表示される (新規バッチ開始用)
    expect(screen.getByRole("button", { name: "開始" })).toBeInTheDocument();
  });
});
