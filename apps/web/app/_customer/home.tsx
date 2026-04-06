import type { Route } from "./+types/home";
import { createDb } from "~/lib/db";
import { getAvailableMenuItems } from "~/features/menu/queries";
import { MenuItemCard } from "./components/MenuItemCard";

export async function loader({ context }: Route.LoaderArgs) {
  const db = createDb(context.cloudflare.env.DB);
  const items = await getAvailableMenuItems(db);
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
          <MenuItemCard
            key={item.id}
            name={item.name}
            price={item.price}
            description={item.description}
          />
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
