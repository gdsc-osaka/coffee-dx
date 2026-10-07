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
    <Card className="border-0 rounded-2xl bg-white shadow-sm">
      <CardContent className="flex items-center justify-between gap-4 py-6 px-6">
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-stone-900">{name}</p>
          {description && <p className="text-sm text-stone-500 mt-1 leading-snug">{description}</p>}
          <p className="text-2xl font-black text-stone-900 mt-2 tabular-nums">
            ¥{price.toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-12 rounded-full border-stone-300"
            onClick={onRemove}
            disabled={quantity === 0}
            aria-label={`${name} を1つ減らす`}
          >
            <Minus className="size-5" />
          </Button>
          <span className="w-8 text-center text-xl font-black text-stone-900 tabular-nums">
            {quantity}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-12 rounded-full border-stone-300"
            onClick={onAdd}
            aria-label={`${name} を1つ増やす`}
          >
            <Plus className="size-5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
