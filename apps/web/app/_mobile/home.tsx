import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useActionData, useNavigate, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { MenuItemCard } from "~/_customer/components/MenuItemCard";
import { cartJsonSchema } from "~/_customer/schemas";
import {
  createMobileOrderRequest,
  getMobileOrderAcceptance,
  isValidMobileStoreToken,
  MobileOrderClosedError,
  MobileOrderConflictError,
  type MobileOrderItemInput,
} from "~/features/mobile-order/actions";
import { createDb } from "~/lib/db";
import { getAvailableMenuItems } from "~/features/menu/queries";
import { getBusinessDate } from "~/lib/order-do";

export async function loader({ params, context }: Route.LoaderArgs) {
  const storeToken = params.storeToken;
  if (!storeToken || !isValidMobileStoreToken(context.cloudflare.env, storeToken)) {
    throw new Response("店舗が見つかりません", { status: 404 });
  }

  const db = createDb(context.cloudflare.env.DB);
  const [items, isAccepting] = await Promise.all([
    getAvailableMenuItems(db),
    getMobileOrderAcceptance(context.cloudflare.env.DB, storeToken),
  ]);
  return { storeToken, items, isAccepting, businessDate: getBusinessDate() };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const storeToken = params.storeToken;
  if (!storeToken || !isValidMobileStoreToken(context.cloudflare.env, storeToken)) {
    return { ok: false as const, error: "店舗が見つかりません。" };
  }

  const formData = await request.formData();
  const cartJson = formData.get("cartJson");
  const idempotencyKey = formData.get("idempotencyKey");
  if (typeof cartJson !== "string" || typeof idempotencyKey !== "string") {
    return { ok: false as const, error: "注文内容が不正です。" };
  }

  const parsed = cartJsonSchema.safeParse(cartJson);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "注文内容が不正です。" };
  }

  try {
    const result = await createMobileOrderRequest(
      context.cloudflare.env.DB,
      context.cloudflare.env,
      storeToken,
      parsed.data,
      idempotencyKey,
    );
    return { ok: true as const, order: result };
  } catch (error) {
    if (error instanceof MobileOrderClosedError) {
      return { ok: false as const, error: error.message, code: "CLOSED" as const };
    }
    if (error instanceof MobileOrderConflictError) {
      return { ok: false as const, error: error.message, code: "CONFLICT" as const };
    }
    if (error instanceof Response) return { ok: false as const, error: "店舗が見つかりません。" };
    console.error("Mobile order creation failed", error);
    return {
      ok: false as const,
      error: "注文を受け付けられませんでした。時間をおいて再度お試しください。",
    };
  }
}

type CartItem = MobileOrderItemInput & { name: string; price: number };
type PendingOrder = { idempotencyKey: string; cart: CartItem[] };
type ConfirmedOrder = { publicToken: string };

function readConfirmedOrder(raw: string): ConfirmedOrder | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const publicToken = (value as Partial<ConfirmedOrder>).publicToken;
    return typeof publicToken === "string" && /^[0-9a-f]{32}$/.test(publicToken)
      ? { publicToken }
      : null;
  } catch {
    return null;
  }
}

function readPendingOrder(raw: string): PendingOrder | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const pending = value as Partial<PendingOrder>;
    if (
      typeof pending.idempotencyKey !== "string" ||
      !/^[\x21-\x7E]{16,128}$/.test(pending.idempotencyKey) ||
      !Array.isArray(pending.cart) ||
      pending.cart.length === 0 ||
      !pending.cart.every(
        (item) =>
          item &&
          typeof item.menuItemId === "string" &&
          item.menuItemId.length > 0 &&
          typeof item.name === "string" &&
          typeof item.price === "number" &&
          Number.isFinite(item.price) &&
          Number.isSafeInteger(item.quantity) &&
          item.quantity > 0,
      ) ||
      pending.cart.reduce((sum, item) => sum + item.quantity, 0) > 9
    ) {
      return null;
    }
    return pending as PendingOrder;
  } catch {
    return null;
  }
}

export default function MobileOrderHome({ loaderData }: Route.ComponentProps) {
  const { items, isAccepting, storeToken } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const idempotencyKey = useRef<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [phase, setPhase] = useState<"menu" | "confirm">("menu");
  const [hasPendingSubmission, setHasPendingSubmission] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const storageKey = `mobile-order:pending:${storeToken}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const confirmed = readConfirmedOrder(raw);
      if (confirmed) {
        void navigate(`/mobile/orders/${confirmed.publicToken}`, { replace: true });
        return;
      }
      const pending = readPendingOrder(raw);
      if (!pending) {
        setStorageError("保存された注文情報を読み取れません。スタッフにご相談ください。");
        return;
      }
      idempotencyKey.current = pending.idempotencyKey;
      setCart(pending.cart);
      setHasPendingSubmission(true);
      setPhase("confirm");
    } catch {
      setStorageError("端末の保存領域を利用できません。ブラウザの設定をご確認ください。");
    }
  }, [navigate, storageKey]);

  useEffect(() => {
    if (!actionData?.ok) return;
    const publicToken = actionData.order.publicToken;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ publicToken }));
    } catch {
      // 公開トークン付きURLへの遷移は、端末の保存領域が利用できなくても行う。
    }
    void navigate(`/mobile/orders/${publicToken}`, { replace: true });
  }, [actionData, navigate, storageKey]);

  const quantities = useMemo(
    () => new Map(cart.map((item) => [item.menuItemId, item.quantity])),
    [cart],
  );
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const isSubmitting = navigation.state === "submitting";
  const completedOrder = actionData?.ok ? actionData.order : null;

  const addItem = (item: (typeof items)[number]) => {
    setCart((current) => {
      const existing = current.find((entry) => entry.menuItemId === item.id);
      if (existing) {
        return current.map((entry) =>
          entry.menuItemId === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry,
        );
      }
      return [...current, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const removeItem = (menuItemId: string) => {
    setCart((current) =>
      current
        .map((item) =>
          item.menuItemId === menuItemId ? { ...item, quantity: item.quantity - 1 } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const key = idempotencyKey.current;
    if (!key) {
      event.preventDefault();
      setStorageError("注文情報を準備できませんでした。もう一度お試しください。");
      return;
    }
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const pending = readPendingOrder(stored);
        if (
          !pending ||
          pending.idempotencyKey !== key ||
          JSON.stringify(pending.cart) !== JSON.stringify(cart)
        ) {
          event.preventDefault();
          setStorageError("別の注文情報が保存されています。画面を再読み込みして確認してください。");
          return;
        }
      }
      window.localStorage.setItem(storageKey, JSON.stringify({ idempotencyKey: key, cart }));
      setHasPendingSubmission(true);
      setStorageError(null);
    } catch {
      event.preventDefault();
      setStorageError("注文情報を端末に保存できません。ブラウザの設定をご確認ください。");
    }
  };

  if (completedOrder) {
    return (
      <main className="min-h-screen bg-stone-100 px-4 py-10">
        <section className="mx-auto max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-emerald-600">注文を受け付けました</p>
          <h1 className="mt-3 text-7xl font-black text-stone-900">#{completedOrder.orderNumber}</h1>
          <p className="mt-5 text-lg font-bold text-stone-800">会計待ち</p>
          <p className="mt-2 text-sm text-stone-500">
            この画面をレジで提示して、会計をお済ませください。
          </p>
          <div className="mt-7 space-y-2 border-t border-stone-100 pt-5 text-left">
            {completedOrder.items.map((item) => (
              <div key={item.menuItemId} className="flex justify-between text-sm text-stone-700">
                <span>{item.name}</span>
                <span>× {item.quantity}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-100 pb-32">
      <header className="bg-stone-900 px-5 py-8 text-white">
        <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Mobile Order</p>
        <h1 className="mt-2 text-2xl font-bold">コーヒー愛好会</h1>
        <p className="mt-2 text-sm text-stone-400">商品を選んで注文してください</p>
      </header>

      {!isAccepting && (
        <div className="mx-4 mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-900">
          現在、モバイルオーダーは受付停止中です。受付再開後にご注文ください。
        </div>
      )}

      <section className="mx-auto max-w-lg space-y-3 px-4 py-5">
        {items.map((item) => (
          <MenuItemCard
            key={item.id}
            name={item.name}
            price={item.price}
            description={item.description}
            quantity={quantities.get(item.id) ?? 0}
            onAdd={() => addItem(item)}
            onRemove={() => removeItem(item.id)}
          />
        ))}
        {items.length === 0 && (
          <p className="py-16 text-center text-sm text-stone-500">
            現在提供できるメニューがありません
          </p>
        )}
      </section>

      {totalItems > 0 && phase === "menu" && (
        <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-4 shadow-lg">
          <div className="mx-auto max-w-lg">
            <button
              type="button"
              disabled={!isAccepting}
              onClick={() => {
                idempotencyKey.current = crypto.randomUUID();
                setPhase("confirm");
              }}
              className="w-full rounded-2xl bg-stone-900 px-5 py-4 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              注文内容を確認する（{totalItems}杯 / ¥{totalPrice.toLocaleString()}）
            </button>
            {!isAccepting && (
              <p className="mt-2 text-center text-xs text-amber-700">現在は受付停止中です。</p>
            )}
            {totalItems > 9 && (
              <p className="mt-2 text-center text-xs text-red-600">1注文あたり最大9杯までです。</p>
            )}
          </div>
        </div>
      )}

      {phase === "confirm" && (
        <div className="fixed inset-0 z-10 overflow-y-auto bg-stone-100 px-4 py-8">
          <section className="mx-auto max-w-lg rounded-3xl bg-white p-6 shadow-lg">
            <h2 className="text-xl font-bold text-stone-900">注文内容の確認</h2>
            <p className="mt-2 text-sm text-stone-500">
              {hasPendingSubmission
                ? "前回の送信結果を同じ注文情報で確認できます。"
                : "内容を確認してから注文を確定してください。"}
            </p>
            <div className="mt-6 divide-y divide-stone-100 border-y border-stone-100">
              {cart.map((item) => (
                <div
                  key={item.menuItemId}
                  className="flex justify-between py-3 text-sm text-stone-700"
                >
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <span>¥{(item.price * item.quantity).toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between py-4 font-bold text-stone-900">
                <span>合計</span>
                <span>¥{totalPrice.toLocaleString()}</span>
              </div>
            </div>
            {totalItems > 9 && (
              <p className="mt-4 text-center text-sm text-red-600">1注文あたり最大9杯までです。</p>
            )}
            {actionData && !actionData.ok && (
              <p className="mt-4 text-center text-sm text-red-600">{actionData.error}</p>
            )}
            {storageError && (
              <p className="mt-4 text-center text-sm text-red-600">{storageError}</p>
            )}
            <Form method="post" onSubmit={handleSubmit} className="mt-6 space-y-3">
              <input type="hidden" name="cartJson" value={JSON.stringify(cart)} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey.current ?? ""} />
              <button
                type="submit"
                disabled={(!isAccepting && !hasPendingSubmission) || isSubmitting || totalItems > 9}
                className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting
                  ? "確認中..."
                  : hasPendingSubmission
                    ? "前回の注文結果を確認する"
                    : "この内容で注文を確定する"}
              </button>
            </Form>
            <button
              type="button"
              disabled={isSubmitting || hasPendingSubmission}
              onClick={() => setPhase("menu")}
              className="mt-3 w-full rounded-2xl border border-stone-200 px-5 py-3 text-sm font-bold text-stone-600 disabled:opacity-40"
            >
              内容を修正する
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
