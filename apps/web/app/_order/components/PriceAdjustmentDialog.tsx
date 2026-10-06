import { Delete, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

type AdjustableItem = {
  id: string;
  name: string;
  price: number;
};

type Props = {
  item: AdjustableItem | null;
  onOpenChange: (open: boolean) => void;
  onComplete: (unitPrice: number, quantity: number) => void;
};

const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "backspace"];

export function PriceAdjustmentDialog({ item, onOpenChange, onComplete }: Props) {
  const [priceInput, setPriceInput] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [hasEditedPrice, setHasEditedPrice] = useState(false);

  useEffect(() => {
    if (!item) return;
    setPriceInput(String(item.price));
    setQuantity(0);
    setHasEditedPrice(false);
  }, [item]);

  const parsedPrice = Number(priceInput);
  const isValidPrice =
    priceInput.length > 0 && Number.isSafeInteger(parsedPrice) && parsedPrice >= 0;
  const canComplete = isValidPrice && quantity > 0;

  const handleKey = (key: string) => {
    if (key === "C") {
      setPriceInput("0");
      setHasEditedPrice(true);
      return;
    }
    if (key === "backspace") {
      setPriceInput((current) => current.slice(0, -1));
      setHasEditedPrice(true);
      return;
    }
    setPriceInput((current) => {
      if (!hasEditedPrice || current === "0") return key;
      const next = `${current}${key}`;
      return Number(next) <= Number.MAX_SAFE_INTEGER ? next : current;
    });
    setHasEditedPrice(true);
  };

  const applyMinus100 = () => {
    const current = isValidPrice ? parsedPrice : 0;
    setPriceInput(String(Math.max(0, current - 100)));
    setHasEditedPrice(true);
  };

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{item?.name ?? "価格変更"}</DialogTitle>
          <DialogDescription>個数を選んでください。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="adjusted-price" className="text-sm font-medium text-stone-700">
              適用単価
            </label>
            <div className="relative mt-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-4xl font-bold text-stone-500">
                ¥
              </span>
              <Input
                id="adjusted-price"
                inputMode="numeric"
                value={priceInput}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, "");
                  if (value === "" || Number(value) <= Number.MAX_SAFE_INTEGER) {
                    setPriceInput(value);
                    setHasEditedPrice(true);
                  }
                }}
                className="h-20 pl-16 text-right text-5xl font-black tabular-nums md:text-5xl"
                aria-invalid={!isValidPrice}
              />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-12 w-full border-red-200 text-red-700 hover:bg-red-50"
            onClick={applyMinus100}
          >
            −100円
          </Button>

          <div className="grid grid-cols-3 gap-2">
            {keypad.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                className="h-12 text-lg font-bold"
                onClick={() => handleKey(key)}
                aria-label={key === "backspace" ? "1桁削除" : undefined}
              >
                {key === "backspace" ? <Delete className="size-5" /> : key}
              </Button>
            ))}
          </div>

          <div className="rounded-xl bg-stone-100 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-stone-800">個数</p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 rounded-full"
                  onClick={() => setQuantity((value) => Math.max(0, value - 1))}
                  disabled={quantity === 0}
                  aria-label="変更する個数を1つ減らす"
                >
                  <Minus className="size-4" />
                </Button>
                <span className="w-8 text-center text-2xl font-black tabular-nums">{quantity}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 rounded-full"
                  onClick={() => setQuantity((value) => value + 1)}
                  aria-label="変更する個数を1つ増やす"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            type="button"
            disabled={!canComplete}
            onClick={() => {
              if (!canComplete) return;
              onComplete(parsedPrice, quantity);
            }}
          >
            完了する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
