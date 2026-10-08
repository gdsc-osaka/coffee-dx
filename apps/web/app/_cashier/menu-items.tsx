import { Form, Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/menu-items";
import {
  createMenuItem,
  setMenuItemAvailability,
  MenuItemValidationError,
  type MenuItemFulfillmentType,
} from "~/features/menu/actions";
import { getAllMenuItems } from "~/features/menu/queries";
import { createDb } from "~/lib/db";
import { requireApiStaff, requirePageStaff } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePageStaff(request, context.cloudflare.env);
  const db = createDb(context.cloudflare.env.DB);
  const rows = await getAllMenuItems(db);
  // fulfillmentType は schema.ts 上は text 列（plain string）としてしか型付けされていないため、
  // 画面側で MenuItemFulfillmentType に絞り込んで扱う。不正な値が紛れ込んでいた場合は
  // "direct" 側に倒して表示だけは崩れないようにする。
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    fulfillmentType: (row.fulfillmentType === "brew"
      ? "brew"
      : "direct") as MenuItemFulfillmentType,
    isAvailable: row.isAvailable === 1,
  }));
  return { items };
}

export async function action({ request, context }: Route.ActionArgs) {
  await requireApiStaff(request, context.cloudflare.env);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle") {
    const menuItemId = formData.get("menuItemId");
    const nextAvailable = formData.get("nextAvailable");
    if (typeof menuItemId !== "string" || typeof nextAvailable !== "string") {
      return { ok: false as const, error: "操作内容が不正です。" };
    }
    try {
      await setMenuItemAvailability(
        createDb(context.cloudflare.env.DB),
        menuItemId,
        nextAvailable === "1",
      );
      return { ok: true as const, kind: "toggle" as const };
    } catch (error) {
      if (error instanceof MenuItemValidationError) {
        return { ok: false as const, error: error.message };
      }
      return { ok: false as const, error: "更新に失敗しました。" };
    }
  }

  if (intent !== "create") {
    return { ok: false as const, error: "操作内容が不正です。" };
  }

  const name = formData.get("name");
  const priceRaw = formData.get("price");
  const fulfillmentType = formData.get("fulfillmentType");
  const description = formData.get("description");

  const price = typeof priceRaw === "string" ? Number(priceRaw) : NaN;
  if (typeof name !== "string" || typeof fulfillmentType !== "string" || Number.isNaN(price)) {
    return { ok: false as const, error: "入力内容を確認してください。" };
  }

  try {
    await createMenuItem(createDb(context.cloudflare.env.DB), {
      name,
      price,
      fulfillmentType: fulfillmentType as MenuItemFulfillmentType,
      description: typeof description === "string" ? description : undefined,
    });
    return { ok: true as const, kind: "create" as const };
  } catch (error) {
    if (error instanceof MenuItemValidationError) {
      return { ok: false as const, error: error.message };
    }
    return { ok: false as const, error: "商品の登録に失敗しました。" };
  }
}

const fulfillmentTypeLabel: Record<MenuItemFulfillmentType, string> = {
  brew: "コーヒー（抽出）",
  direct: "それ以外（そのまま提供）",
};

export default function MenuItems({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs tracking-widest text-stone-400">MENU</p>
            <h1 className="mt-1 text-2xl font-bold text-stone-800">商品登録</h1>
          </div>
          <Link className="text-sm text-stone-500 underline" to="/order">
            注文画面へ戻る
          </Link>
        </header>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-stone-700">新しい商品を登録</h2>

          {actionData && !actionData.ok && (
            <p className="mt-3 text-sm text-red-600">{actionData.error}</p>
          )}
          {actionData?.ok && actionData.kind === "create" && (
            <p className="mt-3 text-sm text-emerald-700">商品を登録しました。</p>
          )}

          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="create" />
            <div>
              <label className="block text-xs font-bold text-stone-500" htmlFor="name">
                商品名
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={50}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-500" htmlFor="price">
                金額（円）
              </label>
              <input
                id="price"
                name="price"
                type="number"
                min={1}
                step={1}
                required
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>
            <fieldset>
              <legend className="block text-xs font-bold text-stone-500">区分</legend>
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input type="radio" name="fulfillmentType" value="brew" defaultChecked required />
                  コーヒー（抽出が必要）
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input type="radio" name="fulfillmentType" value="direct" />
                  それ以外（そのまま提供）
                </label>
              </div>
            </fieldset>
            <div>
              <label className="block text-xs font-bold text-stone-500" htmlFor="description">
                説明（任意）
              </label>
              <input
                id="description"
                name="description"
                type="text"
                maxLength={200}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-stone-800 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? "登録中..." : "この内容で登録する"}
            </button>
          </Form>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-stone-700">登録済みの商品</h2>
          {loaderData.items.length === 0 ? (
            <p className="mt-4 text-sm text-stone-400">登録されている商品はありません。</p>
          ) : (
            <ul className="mt-4 divide-y divide-stone-100">
              {loaderData.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-stone-800">
                      {item.name}
                      <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-500">
                        {fulfillmentTypeLabel[item.fulfillmentType]}
                      </span>
                    </p>
                    <p className="text-xs text-stone-400">¥{item.price.toLocaleString()}</p>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="menuItemId" value={item.id} />
                    <input
                      type="hidden"
                      name="nextAvailable"
                      value={item.isAvailable ? "0" : "1"}
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className={`rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50 ${
                        item.isAvailable
                          ? "border border-amber-200 text-amber-700"
                          : "bg-emerald-600 text-white"
                      }`}
                    >
                      {item.isAvailable ? "販売停止にする" : "販売再開する"}
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
