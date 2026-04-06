import { Card, CardContent } from "~/components/ui/card";

type Props = {
  name: string;
  price: number;
  description: string | null;
};

export function MenuItemCard({ name, price, description }: Props) {
  return (
    <Card className="border-amber-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="flex items-start justify-between gap-4 py-5">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-900 text-base">{name}</p>
          {description && (
            <p className="text-sm text-amber-700/70 mt-1 leading-relaxed">{description}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <span className="text-lg font-bold text-amber-800">
            ¥{price.toLocaleString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
