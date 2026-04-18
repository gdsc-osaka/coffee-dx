import { Minus, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

type Props = {
  name: string;
  price: number;
  description: string | null;
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
};

export function MenuItemCard({ name, price, description, quantity, onAdd, onRemove }: Props) {
  return (
    <Card className="border-0 rounded-xl bg-white shadow-sm">
      <CardContent className="flex items-center justify-between gap-4 py-4 px-5">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-900">{name}</p>
          {description && (
            <p className="text-sm text-stone-500 mt-0.5 leading-snug">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-lg font-bold text-stone-900">¥{price.toLocaleString()}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-full"
              onClick={onRemove}
              disabled={quantity === 0}
              aria-label={`${name} を1つ減らす`}
            >
              <Minus className="size-3" />
            </Button>
            <span className="w-5 text-center font-semibold text-stone-900">{quantity}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-full"
              onClick={onAdd}
              aria-label={`${name} を1つ増やす`}
            >
              <Plus className="size-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
