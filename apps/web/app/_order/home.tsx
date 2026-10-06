import { ArrowLeft, CheckCircle, Coffee, ShoppingBag, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useNavigation, useSubmit } from "react-router";
import type { Route } from "./+types/home";
import { createDb } from "~/lib/db";
import { getAvailableMenuItems, getMenuItemsByIds } from "~/features/menu/queries";
import { createOrder } from "~/features/order/actions";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { MenuItemCard } from "./components/MenuItemCard";
import { cartJsonSchema } from "./schemas";
import { printerClient } from "~/features/printer/printer-client";
import { receiptGenerator } from "~/features/printer/receipt-generator";
import { CashierHeader } from "./components/CashierHeader";
import { OrderHistoryDialog } from "./components/OrderHistoryDialog";
import { PrinterSettingsDialog } from "./components/PrinterSettingsDialog";
import type { ConnectionStatus } from "~/features/printer/printer-client";
import { isLXPrinterError, type PrinterStatus } from "lx-printer/lx-d02";

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest-customer.webmanifest" },
];

export const meta: Route.MetaFunction = () => [
  { title: "注文管理" },
  { name: "apple-mobile-web-app-title", content: "注文管理" },
  { name: "apple-mobile-web-app-status-bar-style", content: "black" },
  { name: "theme-color", content: "#0c0a09" },
];

export async function loader({ context }: Route.LoaderArgs) {
  const db = createDb(context.cloudflare.env.DB);
  const items = await getAvailableMenuItems(db);
  return { items };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const cartJson = formData.get("cartJson");
  const isFree = formData.get("isFree") === "1";

  const parseResult = cartJsonSchema.safeParse(cartJson);
  if (!parseResult.success) {
    return { error: parseResult.error.issues[0]?.message ?? "カートデータが不正です" };
  }

  const requestedItems = parseResult.data;
  const db = createDb(context.cloudflare.env.DB);

  // menuItemId の存在確認と name/price をサーバー側で正規化
  const menuItemIds = requestedItems.map((item) => item.menuItemId);
  const menuItemRecords = await getMenuItemsByIds(db, menuItemIds);
  const menuItemMap = new Map(menuItemRecords.map((m) => [m.id, m]));

  const cartItems = requestedItems
    .map((item) => {
      const menuItem = menuItemMap.get(item.menuItemId);
      if (!menuItem) return null;
      return {
        menuItemId: item.menuItemId,
        name: menuItem.name,
        price: menuItem.price,
        quantity: item.quantity,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (cartItems.length === 0) {
    return { error: "有効なメニューが選択されていません" };
  }

  try {
    const { orderNumber, createdAt } = await createOrder(db, context.cloudflare.env, cartItems, {
      isFree,
    });
    // 印字に必要な name/quantity をサーバー正規化済みの cartItems から返す。
    // クライアントの cart 状態にズレがあっても、レシートと DB に永続化された注文内容を一致させる。
    const items = cartItems.map((c) => ({ name: c.name, quantity: c.quantity }));
    // Date は JSON シリアライズで ISO 文字列に変換されるので、クライアントで new Date() で復元する
    return { orderNumber, createdAt: createdAt.toISOString(), items, isFree };
  } catch {
    return { error: "注文の確定に失敗しました。時間をおいて再度お試しください。" };
  }
}

type CartItem = {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
};

type Phase = "menu" | "confirm" | "complete";

export default function OrderHome({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";

  const [cart, setCart] = useState<CartItem[]>([]);
  const [phase, setPhase] = useState<Phase>("menu");
  const [completedOrderNumber, setCompletedOrderNumber] = useState<number | null>(null);
  const [completedOrderCreatedAt, setCompletedOrderCreatedAt] = useState<Date | null>(null);
  const [completedOrderItems, setCompletedOrderItems] = useState<
    { name: string; quantity: number }[]
  >([]);
  const [completedOrderIsFree, setCompletedOrderIsFree] = useState(false);
  const [isFree, setIsFree] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<ConnectionStatus>("disconnected");
  const [printerStatusData, setPrinterStatusData] = useState<PrinterStatus | null>(null);
  const [optimisticDensity, setOptimisticDensity] = useState<number | null>(null);
  const [isPrinterSettingsOpen, setIsPrinterSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isAutoPrintEnabled, setIsAutoPrintEnabled] = useState(true);
  const processedActionData = useRef<any>(null);

  // 初回マウント時にフォントなどをバックグラウンドでプリロードしておく
  useEffect(() => {
    receiptGenerator.init().catch(console.error);
  }, []);

  useEffect(() => {
    printerClient.onStatusUpdate((status, data) => {
      setPrinterStatus(status);
      setPrinterStatusData(data);
      // 実機からのステータス報告と一致したらオプティミスティック表示を解除
      if (data && data.density === optimisticDensity) {
        setOptimisticDensity(null);
      }
    });
  }, [optimisticDensity]);

  // action完了を検知してフェーズを進める
  useEffect(() => {
    if (!actionData) return;
    if (processedActionData.current === actionData) return;

    if ("orderNumber" in actionData && actionData.orderNumber !== undefined) {
      processedActionData.current = actionData;
      const createdAt = new Date(actionData.createdAt);
      // 印字・表示に使う items は action がサーバー正規化して返したものを採用する
      // （クライアント cart に改変があっても DB に永続化された注文と必ず一致させるため）
      const serverItems = actionData.items ?? [];
      const orderIsFree = actionData.isFree ?? false;
      setCompletedOrderNumber(actionData.orderNumber);
      setCompletedOrderCreatedAt(createdAt);
      setCompletedOrderItems(serverItems);
      setCompletedOrderIsFree(orderIsFree);
      setPhase("complete");

      // 自動印刷の実行
      const printAuto = async () => {
        if (!isAutoPrintEnabled) return;
        try {
          const canvas = await receiptGenerator.generate({
            orderNumber: actionData.orderNumber!,
            items: serverItems,
            timestamp: createdAt,
            isFree: orderIsFree,
          });
          await printerClient.print(canvas);
        } catch (e) {
          if (isLXPrinterError(e) && e.code === "ALREADY_PRINTING") {
            // 別の印刷ジョブが進行中だったため二重印刷を回避。手動で再印刷可能なため致命的ではない
            console.warn("Auto print skipped: printer is already printing");
          } else {
            console.error("Auto print failed:", e);
          }
        }
      };
      printAuto();
    }
  }, [actionData, isAutoPrintEnabled]);

  const handlePrintSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;

    // プリンターが未接続の場合のみ接続を試みる (自動印刷が有効な場合のみ)
    if (isAutoPrintEnabled && printerStatus !== "connected") {
      try {
        await printerClient.connect();
      } catch (e) {
        console.error("Printer connection failed:", e);
      }
    }

    submit(form);
  };

  const handleReprint = async () => {
    if (completedOrderNumber === null || completedOrderCreatedAt === null) return;
    if (!window.confirm("レシートを再印刷しますか？")) return;

    try {
      if (printerStatus === "disconnected" || printerStatus === "error") {
        await printerClient.connect();
      }
      const canvas = await receiptGenerator.generate({
        orderNumber: completedOrderNumber,
        items: completedOrderItems,
        timestamp: completedOrderCreatedAt,
        isFree: completedOrderIsFree,
      });
      await printerClient.print(canvas);
    } catch (e) {
      if (isLXPrinterError(e) && e.code === "ALREADY_PRINTING") {
        alert("プリンターが印刷中です。完了後にもう一度お試しください。");
      } else {
        alert("再印刷に失敗しました。プリンターの状態を確認してください。");
      }
      console.error("Reprint failed:", e);
    }
  };

  const getQuantity = (menuItemId: string) =>
    cart.find((c) => c.menuItemId === menuItemId)?.quantity ?? 0;

  const handleAdd = (item: { id: string; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) {
        return prev.map((c) => (c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const handleRemove = (menuItemId: string) => {
    setCart((prev) =>
      prev
        .map((c) => (c.menuItemId === menuItemId ? { ...c, quantity: c.quantity - 1 } : c))
        .filter((c) => c.quantity > 0),
    );
  };

  const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const confirmButtonBgColor = isFree
    ? "bg-sky-600 hover:bg-sky-500"
    : "bg-emerald-600 hover:bg-emerald-500";
  const isConfirmButtonDisabled = isSubmitting || Boolean(printerStatusData?.isPrinting);

  const getConfirmButtonText = () => {
    if (isSubmitting) return "処理中...";
    if (printerStatusData?.isPrinting) return "印刷中...";
    return isFree ? "無料で確定する" : "支払いを確定する";
  };

  const handleCloseDialog = () => {
    if (phase === "complete") {
      setCart([]);
      setCompletedOrderNumber(null);
      setCompletedOrderCreatedAt(null);
      setCompletedOrderItems([]);
      setCompletedOrderIsFree(false);
      setIsFree(false);
    }
    setPhase("menu");
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col">
      {/* スタッフ向けヘッダー */}
      <CashierHeader
        printerStatus={printerStatus}
        printerStatusData={printerStatusData}
        onOpenSettings={() => setIsPrinterSettingsOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
      />

      <header className="bg-stone-900 px-4 py-8">
        <div className="flex items-center gap-3">
          <Coffee className="size-6 text-white" />
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">コーヒー愛好会</h1>
            <p className="text-stone-400 text-xs mt-0.5 tracking-widest uppercase">Today's Menu</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-3 pb-36">
        {items.map((item) => (
          <MenuItemCard
            key={item.id}
            name={item.name}
            price={item.price}
            description={item.description}
            quantity={getQuantity(item.id)}
            onAdd={() => handleAdd(item)}
            onRemove={() => handleRemove(item.id)}
          />
        ))}

        {items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-stone-400">
            <Coffee className="size-8" />
            <p className="text-sm">現在提供できるメニューがありません</p>
          </div>
        )}
      </main>

      {/* カート合計バー */}
      {totalItems > 0 && phase === "menu" && (
        <div className="fixed bottom-0 inset-x-0 p-4 bg-white border-t border-stone-200 shadow-lg">
          <div className="max-w-lg mx-auto flex flex-col gap-2">
            <Button
              type="button"
              className="w-full bg-stone-900 hover:bg-stone-800 text-white h-16 text-lg rounded-2xl"
              onClick={() => {
                setIsFree(false);
                setPhase("confirm");
              }}
            >
              <ShoppingBag className="size-5 mr-2" />
              <span className="flex-1 text-left">注文を確認する</span>
              <span className="font-black text-xl">¥{totalPrice.toLocaleString()}</span>
            </Button>
            <Button
              type="button"
              className="w-full h-12 text-base rounded-2xl bg-sky-600 hover:bg-sky-500 text-white"
              onClick={() => {
                setIsFree(true);
                setPhase("confirm");
              }}
            >
              無料で注文する
            </Button>
          </div>
        </div>
      )}

      {/* 会計確認フェーズ — スタッフ向けの通常方向レイアウト */}
      {phase === "confirm" && (
        <div className="fixed inset-0 z-40 flex flex-col bg-stone-100">
          <header className="shrink-0 bg-stone-900 px-4 py-4 text-white">
            <div className="mx-auto flex max-w-lg items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white hover:bg-stone-800 hover:text-white"
                onClick={() => {
                  setIsFree(false);
                  setPhase("menu");
                }}
                aria-label="商品選択に戻る"
              >
                <ArrowLeft className="size-5" />
              </Button>
              <div>
                <h2 className="text-lg font-bold">注文内容の確認</h2>
                <p className="text-xs text-stone-400">内容と金額を確認して会計を確定します</p>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-lg min-h-0 flex-1 overflow-y-auto px-4 py-5">
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={item.menuItemId} className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-stone-900">{item.name}</p>
                      <p className="mt-1 text-sm text-stone-500 tabular-nums">
                        ¥{item.price.toLocaleString()} × {item.quantity}
                      </p>
                    </div>
                    <p className="text-lg font-black text-stone-900 tabular-nums">
                      ¥{(item.price * item.quantity).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {actionData && "error" in actionData && (
              <p className="mt-4 rounded-xl bg-red-50 p-3 text-center text-sm text-red-700">
                {actionData.error}
              </p>
            )}
          </main>

          <div className="shrink-0 border-t border-stone-200 bg-white p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
            <div className="mx-auto max-w-lg space-y-3">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm text-stone-500">{totalItems}点の合計</p>
                  {isFree && <p className="text-sm font-bold text-sky-600">無料サービス</p>}
                </div>
                <p className="text-4xl font-black text-stone-900 tabular-nums">
                  ¥{totalPrice.toLocaleString()}
                </p>
              </div>
              <Form method="post" onSubmit={handlePrintSubmit}>
                <input type="hidden" name="cartJson" value={JSON.stringify(cart)} />
                <input type="hidden" name="isFree" value={isFree ? "1" : "0"} />
                <Button
                  type="submit"
                  className={`w-full h-16 text-xl font-black text-white border-0 rounded-2xl ${confirmButtonBgColor}`}
                  disabled={isConfirmButtonDisabled}
                >
                  {getConfirmButtonText()}
                </Button>
              </Form>
              {isAutoPrintEnabled && (
                <p className="text-xs text-stone-500 text-center">
                  ※プリンター未接続時は会計確定時に接続ダイアログが表示されます
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                className="w-full text-stone-500"
                onClick={() => {
                  setIsFree(false);
                  setPhase("menu");
                }}
              >
                商品選択に戻る
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 注文完了ダイアログ */}
      <Dialog open={phase === "complete"} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent showCloseButton={!isSubmitting}>
          {completedOrderNumber !== null && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="flex flex-col items-center gap-3">
                <CheckCircle className="size-14 text-green-600" />
                <DialogHeader>
                  <DialogTitle className="text-center text-xl">注文が確定しました</DialogTitle>
                </DialogHeader>
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="text-stone-500 text-sm">お客様の番号</p>
                <p className="text-7xl font-black text-stone-900 leading-none">
                  #{completedOrderNumber}
                </p>
              </div>
              <p className="text-stone-500 text-sm text-center">ドリップ完了後にお呼びします</p>
              <div className="flex flex-col w-full gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12 text-stone-600"
                  onClick={handleReprint}
                  disabled={printerStatus === "connecting" || printerStatusData?.isPrinting}
                >
                  <Printer className="size-4 mr-2" />
                  {printerStatusData?.isPrinting ? "印刷中..." : "再印刷"}
                </Button>
                <Button
                  type="button"
                  className="w-full h-12 bg-stone-900 text-white"
                  onClick={handleCloseDialog}
                >
                  閉じる
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PrinterSettingsDialog
        open={isPrinterSettingsOpen}
        onOpenChange={setIsPrinterSettingsOpen}
        printerStatus={printerStatus}
        printerStatusData={printerStatusData}
        optimisticDensity={optimisticDensity}
        setOptimisticDensity={setOptimisticDensity}
        isAutoPrintEnabled={isAutoPrintEnabled}
        setIsAutoPrintEnabled={setIsAutoPrintEnabled}
      />

      <OrderHistoryDialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen} />
    </div>
  );
}
