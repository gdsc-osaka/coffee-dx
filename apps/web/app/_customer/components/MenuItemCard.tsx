import { Card, CardContent } from "~/components/ui/card";

type Props = {
  name: string;
  price: number;
  description: string | null;
};

export function MenuItemCard({ name, price, description }: Props) {
  return (
    <Card className="border-0 rounded-xl bg-white shadow-sm">
      <CardContent className="flex items-center justify-between gap-4 py-4 px-5">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-900">{name}</p>
          {description && (
            <p className="text-sm text-stone-500 mt-0.5 leading-snug">{description}</p>
          )}
        </div>
        <span className="shrink-0 text-lg font-bold text-stone-900">¥{price.toLocaleString()}</span>
      </CardContent>
    </Card>
  );
}
