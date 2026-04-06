import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/home";
import { menuItems } from "../../db/schema";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";

export async function loader({ context }: Route.LoaderArgs) {
  const db = drizzle(context.cloudflare.env.DB);
  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.isAvailable, 1));
  return { items };
}

export default function CustomerHome({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-amber-800 text-white py-6 px-4">
        <h1 className="text-2xl font-bold text-center">コーヒー同好会</h1>
        <p className="text-center text-amber-200 text-sm mt-1">メニュー</p>
      </header>

      <main className="max-w-lg mx-auto p-4 mt-4 space-y-3">
        {items.map((item) => (
          <Card key={item.id} className="border-amber-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{item.name}</CardTitle>
                <Badge className="bg-amber-700 hover:bg-amber-800 text-white">
                  ¥{item.price.toLocaleString()}
                </Badge>
              </div>
            </CardHeader>
            {item.description && (
              <CardContent>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </CardContent>
            )}
          </Card>
        ))}

        {items.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            現在提供できるメニューがありません
          </p>
        )}
      </main>
    </div>
  );
}
