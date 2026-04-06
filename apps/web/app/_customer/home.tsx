import type { Route } from "./+types/home";
import { createDb } from "~/lib/db";
import { getAvailableMenuItems } from "~/features/menu/queries";
import { MenuItemCard } from "./components/MenuItemCard";
import { Coffee } from "lucide-react";

export async function loader({ context }: Route.LoaderArgs) {
  const db = createDb(context.cloudflare.env.DB);
  const items = await getAvailableMenuItems(db);
  return { items };
}

export default function CustomerHome({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="bg-stone-900 px-4 py-8">
        <div className="flex items-center gap-3">
          <Coffee className="size-6 text-white" />
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">コーヒー愛好会</h1>
            <p className="text-stone-400 text-xs mt-0.5 tracking-widest uppercase">Today's Menu</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-2">
        {items.map((item) => (
          <MenuItemCard
            key={item.id}
            name={item.name}
            price={item.price}
            description={item.description}
          />
        ))}

        {items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-stone-400">
            <Coffee className="size-8" />
            <p className="text-sm">現在提供できるメニューがありません</p>
          </div>
        )}
      </main>
    </div>
  );
}
