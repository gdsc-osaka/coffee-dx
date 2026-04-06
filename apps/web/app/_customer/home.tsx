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
    <div className="min-h-screen bg-amber-50">
      <header className="bg-amber-900 text-white pt-10 pb-8 px-4 shadow-md">
        <div className="flex flex-col items-center gap-2">
          <div className="bg-amber-700 rounded-full p-3">
            <Coffee className="size-7 text-amber-100" />
          </div>
          <h1 className="text-2xl font-bold tracking-wide">コーヒー同好会</h1>
          <p className="text-amber-300 text-sm">本日のメニュー</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-3">
        {items.map((item) => (
          <MenuItemCard
            key={item.id}
            name={item.name}
            price={item.price}
            description={item.description}
          />
        ))}

        {items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-amber-700/60">
            <Coffee className="size-10" />
            <p className="text-sm">現在提供できるメニューがありません</p>
          </div>
        )}
      </main>
    </div>
  );
}
