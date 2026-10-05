import { Check, Coffee, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/order-receipt";
import {
  getMobileOrderByPublicToken,
  type MobileOrderRequestResult,
  type MobileOrderStatus,
} from "~/features/mobile-order/actions";
import { mobilePublicTokenSchema } from "~/features/mobile-order/schemas";

const REFRESH_INTERVAL_MS = 5_000;

export async function loader({ params, context }: Route.LoaderArgs) {
  const publicToken = params.publicToken;
  if (!mobilePublicTokenSchema.safeParse(publicToken).success) {
    throw new Response("注文が見つかりません", { status: 404 });
  }
  const order = await getMobileOrderByPublicToken(context.cloudflare.env.DB, publicToken);
  if (!order) throw new Response("注文が見つかりません", { status: 404 });
  return { order };
}

export type MobileOrderDisplayState = "payment" | "brewing" | "ready" | "completed" | "cancelled";

export function getMobileOrderDisplayState(
  order: Pick<MobileOrderRequestResult, "status" | "orderStatus">,
): MobileOrderDisplayState {
  if (order.status === "cancelled" || order.orderStatus === "cancelled") return "cancelled";
  if (order.orderStatus === "completed") return "completed";
  if (order.orderStatus === "ready") return "ready";
  if (order.status === "awaiting_payment") return "payment";
  return "brewing";
}

type StateTheme = {
  accent: string;
  darkText: string;
  softBackground: string;
  border: string;
  ring: string;
  progressWidth: string;
};

const stateThemes: Record<MobileOrderDisplayState, StateTheme> = {
  payment: {
    accent: "bg-amber-600",
    darkText: "text-amber-800",
    softBackground: "bg-amber-50",
    border: "border-amber-200",
    ring: "ring-amber-50",
    progressWidth: "w-0",
  },
  brewing: {
    accent: "bg-orange-600",
    darkText: "text-orange-800",
    softBackground: "bg-orange-50",
    border: "border-orange-200",
    ring: "ring-orange-50",
    progressWidth: "w-1/2",
  },
  ready: {
    accent: "bg-emerald-600",
    darkText: "text-emerald-800",
    softBackground: "bg-emerald-50",
    border: "border-emerald-200",
    ring: "ring-emerald-50",
    progressWidth: "w-full",
  },
  completed: {
    accent: "bg-emerald-600",
    darkText: "text-emerald-800",
    softBackground: "bg-emerald-50",
    border: "border-emerald-200",
    ring: "ring-emerald-50",
    progressWidth: "w-full",
  },
  cancelled: {
    accent: "bg-stone-500",
    darkText: "text-stone-700",
    softBackground: "bg-stone-50",
    border: "border-stone-200",
    ring: "ring-stone-100",
    progressWidth: "w-0",
  },
};

const progressSteps = [
  { key: "payment", label: "会計待ち" },
  { key: "brewing", label: "抽出待ち" },
  { key: "ready", label: "受け取り可能" },
] as const;

function getStateContent(
  state: MobileOrderDisplayState,
  theme: StateTheme,
): {
  pill: string;
  title: string;
  instruction: ReactNode;
} {
  switch (state) {
    case "payment":
      return {
        pill: "現在：会計待ち",
        title: "お会計をお願いします",
        instruction: (
          <>
            この画面を<strong className={theme.darkText}>レジスタッフに見せて</strong>
            、お支払いください。
            <br />
            会計後、自動で抽出待ちに切り替わります。
          </>
        ),
      };
    case "brewing":
      return {
        pill: "現在：抽出待ち",
        title: "抽出をお待ちください",
        instruction: (
          <>
            ご注文を順番にお作りします。
            <br />
            <strong className={theme.darkText}>この画面のまま</strong>
            、受け取り可能になるまでお待ちください。
          </>
        ),
      };
    case "ready":
      return {
        pill: "現在：受け取り可能",
        title: "コーヒーができました",
        instruction: (
          <>
            受付番号を確認のうえ、
            <strong className={theme.darkText}>受取口までお越しください</strong>。
            <br />
            スタッフにこの画面をお見せください。
          </>
        ),
      };
    case "completed":
      return {
        pill: "現在：受取済み",
        title: "受け取り済みです",
        instruction: "商品をお渡し済みです。ご利用ありがとうございました。",
      };
    case "cancelled":
      return {
        pill: "現在：取消済み",
        title: "注文は取り消されました",
        instruction: "注文は取り消されました。スタッフにお声がけください。",
      };
  }
}

function StatusProgress({ state, theme }: { state: MobileOrderDisplayState; theme: StateTheme }) {
  const currentIndex =
    state === "payment" ? 0 : state === "brewing" ? 1 : state === "ready" ? 2 : 3;
  const isCancelled = state === "cancelled";

  return (
    <div className="relative mx-4 grid grid-cols-3 pb-5 pt-6" aria-label="注文の進行状況">
      <div className="absolute inset-x-[16.666667%] top-[2.45rem] h-[3px] rounded-full bg-stone-200">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${theme.accent} ${theme.progressWidth}`}
        />
      </div>
      {progressSteps.map((step, index) => {
        const isReached = !isCancelled && currentIndex >= index;
        const isActive = !isCancelled && currentIndex === index;
        return (
          <div
            key={step.key}
            aria-current={isActive ? "step" : undefined}
            className={`relative z-10 flex min-w-0 flex-col items-center gap-2 text-center text-[0.7rem] font-extrabold leading-snug ${
              isActive ? theme.darkText : isReached ? "text-stone-500" : "text-stone-400"
            }`}
          >
            <span
              className={`grid size-[2.1rem] place-items-center rounded-full border-[3px] border-white text-xs font-black shadow-[0_0_0_1px_#d6d3d1] ${
                isReached ? `${theme.accent} text-white` : "bg-stone-200 text-stone-500"
              } ${isActive ? `scale-110 ring-4 ${theme.ring}` : ""}`}
            >
              {isReached && index < currentIndex ? "✓" : index + 1}
            </span>
            <span className="whitespace-nowrap">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatOrderDate(value: string) {
  return value.replace(/^(\d{4})-(\d{2})-(\d{2}) /, "$1/$2/$3 ");
}

function isMobileOrderStatus(value: unknown): value is MobileOrderStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MobileOrderStatus>;
  return (
    (candidate.status === "awaiting_payment" ||
      candidate.status === "paid" ||
      candidate.status === "cancelled") &&
    (candidate.orderStatus === null ||
      candidate.orderStatus === "pending" ||
      candidate.orderStatus === "brewing" ||
      candidate.orderStatus === "ready" ||
      candidate.orderStatus === "completed" ||
      candidate.orderStatus === "cancelled")
  );
}

async function copyCurrentUrl() {
  const url = window.location.href;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("URLのコピーに失敗しました");
}

function MobileOrderReceiptContent({ order }: { order: MobileOrderRequestResult }) {
  const [latestStatus, setLatestStatus] = useState<MobileOrderStatus>({
    status: order.status,
    orderStatus: order.orderStatus,
  });
  const [connectionState, setConnectionState] = useState<"connected" | "retrying">("connected");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const state = getMobileOrderDisplayState(latestStatus);
  const theme = stateThemes[state];
  const content = getStateContent(state, theme);
  const shouldPoll = state !== "cancelled" && state !== "completed";
  const showSaveNotice = shouldPoll;

  useEffect(() => {
    if (!shouldPoll) return;

    let active = true;
    let inFlight = false;
    let refreshOnCompletion = false;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;

    const scheduleNext = () => {
      timeoutId = window.setTimeout(() => {
        timeoutId = undefined;
        void refresh();
      }, REFRESH_INTERVAL_MS);
    };

    const refresh = async () => {
      if (!active || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      controller = new AbortController();
      let terminal = false;
      try {
        const response = await fetch(`/mobile/orders/${order.publicToken}/status`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`注文状態の取得に失敗しました: ${response.status}`);
        const nextStatus: unknown = await response.json();
        if (!isMobileOrderStatus(nextStatus)) throw new Error("注文状態の応答が不正です");
        if (!active) return;
        setLatestStatus(nextStatus);
        setConnectionState("connected");
        terminal = ["completed", "cancelled"].includes(getMobileOrderDisplayState(nextStatus));
      } catch {
        if (active && !controller.signal.aborted) setConnectionState("retrying");
      } finally {
        inFlight = false;
        controller = undefined;
        if (active && !terminal && document.visibilityState === "visible") {
          if (refreshOnCompletion) {
            refreshOnCompletion = false;
            void refresh();
          } else {
            scheduleNext();
          }
        }
      }
    };

    scheduleNext();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        window.clearTimeout(timeoutId);
        controller?.abort();
        return;
      }
      window.clearTimeout(timeoutId);
      if (inFlight) refreshOnCompletion = true;
      else void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [order.publicToken, shouldPoll]);

  const handleCopyUrl = async () => {
    try {
      await copyCurrentUrl();
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2_500);
    } catch {
      setCopyState("error");
    }
  };

  return (
    <>
      <header className="border-b border-stone-800 bg-stone-900 text-white">
        <div className="mx-auto flex max-w-[34rem] items-center gap-3 px-5 py-[1.15rem]">
          <div className="grid size-10 shrink-0 place-items-center rounded-[0.85rem] border border-stone-600 bg-stone-800 text-amber-400">
            <Coffee className="size-[1.4rem]" aria-hidden="true" />
          </div>
          <div>
            <p className="m-0 text-base font-extrabold tracking-wide">コーヒー愛好会</p>
            <p className="m-0 mt-0.5 text-[0.65rem] uppercase tracking-[0.16em] text-stone-400">
              Order Status
            </p>
          </div>
        </div>
      </header>

      <main
        className="min-h-screen bg-stone-100 px-4 pb-32 pt-5"
        style={{
          background:
            "radial-gradient(circle at 50% 0, rgba(245, 158, 11, 0.08), transparent 22rem), #f5f5f4",
        }}
      >
        <section className="mx-auto max-w-[34rem] overflow-hidden rounded-3xl border border-stone-200 bg-white/95 shadow-[0_10px_30px_rgba(41,37,36,0.06)]">
          <div className="flex items-center justify-between gap-4 border-b border-stone-100 bg-stone-50 px-5 py-3 text-[0.72rem] font-bold text-stone-500">
            <span>ご注文の進行状況</span>
            {shouldPoll && (
              <span className="inline-flex items-center gap-2" aria-live="polite">
                <span
                  className={`size-[0.45rem] rounded-full ${
                    connectionState === "retrying" ? "bg-amber-500" : "animate-pulse bg-emerald-500"
                  }`}
                />
                {connectionState === "retrying" ? "再接続中" : "自動更新中"}
              </span>
            )}
          </div>
          <StatusProgress state={state} theme={theme} />
          <div
            aria-live="polite"
            className={`mx-4 mb-4 rounded-[1.15rem] border px-5 py-5 text-center transition-colors ${theme.softBackground} ${theme.border}`}
          >
            <span
              className={`mb-3 inline-flex min-h-7 items-center gap-2 rounded-full border bg-white px-3 py-1 text-[0.7rem] font-black ${theme.border} ${theme.darkText}`}
            >
              <span className={`size-[0.45rem] rounded-full ${theme.accent}`} />
              {content.pill}
            </span>
            <h1 className="m-0 text-[clamp(1.45rem,6vw,1.9rem)] font-extrabold leading-tight tracking-tight text-stone-800">
              {content.title}
            </h1>
            <p className="mx-auto mt-3 max-w-96 text-sm leading-7 text-stone-600">
              {content.instruction}
            </p>
          </div>
        </section>

        {showSaveNotice && (
          <section
            aria-label="注文控えの保存について"
            className="mx-auto mt-4 max-w-[34rem] rounded-3xl border-2 border-amber-300 bg-amber-50 px-5 py-5 text-center shadow-[0_8px_24px_rgba(180,83,9,0.08)]"
          >
            <p className="m-0 text-base font-black leading-relaxed text-amber-950">
              受け取りまでこの画面を閉じないでください。
            </p>
            <p className="mx-auto mt-2 max-w-[30rem] text-sm leading-6 text-amber-900">
              閉じた場合に備えて、注文控えURLをコピーするか、画面をスクリーンショットで保存してください。
            </p>
            <button
              type="button"
              onClick={() => void handleCopyUrl()}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-amber-800 focus:outline-none focus:ring-4 focus:ring-amber-200"
            >
              {copyState === "copied" ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copyState === "copied" ? "注文控えURLをコピーしました" : "注文控えURLをコピー"}
            </button>
            <p
              aria-live="polite"
              className={`m-0 mt-2 min-h-5 text-xs font-bold ${copyState === "error" ? "text-red-700" : "text-amber-800"}`}
            >
              {copyState === "error"
                ? "コピーできませんでした。URLを手動で保存してください。"
                : "控えが見つからない場合は、再注文せずスタッフにお声がけください。"}
            </p>
          </section>
        )}

        <section className="mx-auto mt-4 max-w-[34rem] rounded-3xl border border-stone-200 bg-white/95 px-5 pb-5 pt-5 shadow-[0_10px_30px_rgba(41,37,36,0.06)]">
          <div className="flex items-center justify-between gap-4 border-b border-dashed border-stone-300 pb-4">
            <h2 className="m-0 text-[0.78rem] font-black tracking-[0.12em] text-stone-700">
              ご注文内容
            </h2>
            <span className="text-[0.65rem] tracking-[0.08em] text-stone-400">ORDER RECEIPT</span>
          </div>

          <div className="border-b border-dashed border-stone-300 py-6 text-center">
            <p className="m-0 text-xs font-extrabold tracking-wider text-stone-500">受付番号</p>
            <p className="m-0 mt-1 text-[clamp(4.4rem,21vw,6.4rem)] font-black leading-[0.95] tracking-[-0.07em] tabular-nums text-stone-900">
              #{order.orderNumber}
            </p>
          </div>

          <div className="flex justify-between gap-4 border-b border-dashed border-stone-300 py-4 text-xs text-stone-500">
            <span>注文日時</span>
            <time className="font-extrabold tabular-nums text-stone-700">
              {formatOrderDate(order.createdAt)}
            </time>
          </div>

          <ul
            aria-label="注文商品"
            className="m-0 list-none border-b border-dashed border-stone-300 px-0 py-2"
          >
            {order.items.map((item) => (
              <li
                key={item.menuItemId}
                className="flex items-baseline justify-between gap-4 py-3 text-stone-700"
              >
                <span className="text-[0.93rem] font-bold">{item.name}</span>
                <span className="min-w-12 text-right text-base font-black tabular-nums">
                  × {item.quantity}
                </span>
              </li>
            ))}
          </ul>

          <p className="m-0 pt-4 text-center text-[0.68rem] leading-relaxed text-stone-400">
            大阪大学コーヒー愛好会
            <br />A Cup of Coffee with You.
          </p>
        </section>

        <p className="mx-auto mt-4 max-w-[34rem] text-center text-[0.72rem] leading-relaxed text-stone-500">
          注文内容にお間違いがある場合は、レジスタッフまでお声がけください。
        </p>
      </main>
    </>
  );
}

export default function MobileOrderReceipt({ loaderData }: Route.ComponentProps) {
  return <MobileOrderReceiptContent key={loaderData.order.publicToken} order={loaderData.order} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <section className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-stone-900">
          {notFound ? "注文が見つかりません" : "注文状況を読み込めませんでした"}
        </h1>
        <p className="mt-3 text-sm text-stone-600">
          {notFound
            ? "注文控えのURLをご確認ください。"
            : "通信状況を確認して、もう一度お試しください。"}
        </p>
        {!notFound && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 w-full rounded-2xl bg-stone-900 px-5 py-4 font-bold text-white"
          >
            再試行する
          </button>
        )}
      </section>
    </main>
  );
}
