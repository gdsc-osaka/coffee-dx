import { CheckCircle, Coffee, ShoppingBag, Printer } from "lucide-react";
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
import { PrinterSettingsDialog } from "./components/PrinterSettingsDialog";
import type { ConnectionStatus } from "~/features/printer/printer-client";
import type { PrinterStatus } from "lx-printer/lx-d02";

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
    const { orderNumber } = await createOrder(db, context.cloudflare.env, cartItems);
    return { orderNumber };
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

export default function CustomerHome({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";

  const [cart, setCart] = useState<CartItem[]>([]);
  const [phase, setPhase] = useState<Phase>("menu");
  const [completedOrderNumber, setCompletedOrderNumber] = useState<number | null>(null);
  const [printerStatus, setPrinterStatus] = useState<ConnectionStatus>("disconnected");
  const [printerStatusData, setPrinterStatusData] = useState<PrinterStatus | null>(null);
  const [optimisticDensity, setOptimisticDensity] = useState<number | null>(null);
  const [isPrinterSettingsOpen, setIsPrinterSettingsOpen] = useState(false);
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
      setCompletedOrderNumber(actionData.orderNumber);
      setPhase("complete");

      // 自動印刷の実行
      const printAuto = async () => {
        if (!isAutoPrintEnabled) return;
        try {
          const canvas = await receiptGenerator.generate({
            orderNumber: actionData.orderNumber!,
            items: cart.map((c) => ({ name: c.name, quantity: c.quantity })),
            timestamp: new Date(),
          });
          await printerClient.print(canvas);
        } catch (e) {
          console.error("Auto print failed:", e);
        }
      };
      printAuto();
    }
  }, [actionData, cart, isAutoPrintEnabled]);

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
    if (completedOrderNumber === null) return;
    if (!window.confirm("レシートを再印刷しますか？")) return;

    try {
      const canvas = await receiptGenerator.generate({
        orderNumber: completedOrderNumber,
        items: cart.map((c) => ({ name: c.name, quantity: c.quantity })),
        timestamp: new Date(),
      });
      await printerClient.print(canvas);
    } catch (e) {
      alert("再印刷に失敗しました。プリンターの状態を確認してください。");
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

  const handleCloseDialog = () => {
    if (phase === "complete") {
      setCart([]);
      setCompletedOrderNumber(null);
    }
    setPhase("menu");
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col">
      {/* スタッフ向けヘッダー (常に表示・180°回転) */}
      <CashierHeader
        printerStatus={printerStatus}
        printerStatusData={printerStatusData}
        onOpenSettings={() => setIsPrinterSettingsOpen(true)}
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
          <div className="max-w-lg mx-auto">
            <Button
              type="button"
              className="w-full bg-stone-900 hover:bg-stone-800 text-white h-16 text-lg rounded-2xl"
              onClick={() => setPhase("confirm")}
            >
              <ShoppingBag className="size-5 mr-2" />
              <span className="flex-1 text-left">注文を確認する</span>
              <span className="font-black text-xl">¥{totalPrice.toLocaleString()}</span>
            </Button>
          </div>
        </div>
      )}

      {/* 会計確認フェーズ — フルスクリーン二分割 */}
      {phase === "confirm" && (
        <div className="fixed inset-0 flex flex-col">
          {/* 上部: スタッフ向け（180°回転してカウンター越しに読める） */}
          <div className="shrink-0 flex flex-col rotate-180 bg-stone-900 p-3 gap-2">
            <p className="text-stone-500 text-xs text-center tracking-widest uppercase">Cashier</p>
            <div className="space-y-1">
              {cart.map((item) => (
                <div key={item.menuItemId} className="flex justify-between text-sm text-white">
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <span className="tabular-nums">
                    ¥{(item.price * item.quantity).toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="border-t border-stone-700 mt-1.5 pt-1.5 flex justify-between items-baseline">
                <span className="text-stone-400 text-sm">合計</span>
                <span className="text-6xl font-black text-white tabular-nums">
                  ¥{totalPrice.toLocaleString()}
                </span>
              </div>
            </div>
            {actionData && "error" in actionData && (
              <p className="text-sm text-red-400 text-center">{actionData.error}</p>
            )}
            <Form method="post" onSubmit={handlePrintSubmit}>
              <input type="hidden" name="cartJson" value={JSON.stringify(cart)} />
              <Button
                type="submit"
                className="w-full h-14 text-2xl font-black bg-emerald-600 hover:bg-emerald-500 text-white border-0 rounded-2xl"
                disabled={isSubmitting}
              >
                {isSubmitting ? "処理中..." : "会計を確定する"}
              </Button>
            </Form>
            {isAutoPrintEnabled && (
              <p className="text-[10px] text-stone-600 text-center">
                ※プリンター未接続時は会計確定時に接続ダイアログが表示されます
              </p>
            )}
            <button
              type="button"
              className="text-stone-600 text-sm text-center py-0.5"
              onClick={() => setPhase("menu")}
            >
              キャンセル
            </button>
          </div>

          {/* 区切り線 */}
          <div className="h-1 bg-stone-300 shrink-0" />

          {/* 下部: お客様向け（正位）*/}
          <div className="flex-1 flex flex-col items-center justify-center gap-5 bg-stone-50 p-8">
            <p className="text-2xl font-bold text-stone-700 tracking-wide">
              現金でお支払いください
            </p>
            <p className="text-8xl font-black text-stone-900 tabular-nums leading-none">
              ¥{totalPrice.toLocaleString()}
            </p>
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
                >
                  <Printer className="size-4 mr-2" />
                  再印刷
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
    </div>
  );
}
