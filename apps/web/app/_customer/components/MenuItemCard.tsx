import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";

type Props = {
  name: string;
  price: number;
  description: string | null;
};

export function MenuItemCard({ name, price, description }: Props) {
  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{name}</CardTitle>
          <Badge className="bg-amber-700 hover:bg-amber-800 text-white">
            ¥{price.toLocaleString()}
          </Badge>
        </div>
      </CardHeader>
      {description && (
        <CardContent>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
      )}
    </Card>
  );
}
