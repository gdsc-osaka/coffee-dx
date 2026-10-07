import { eq } from "drizzle-orm";
import { menuItems } from "../../../db/schema";
import { getJstNowString } from "../../lib/datetime";
import { createDb } from "../../lib/db";

type Db = ReturnType<typeof createDb>;

export type MenuItemFulfillmentType = "brew" | "direct";

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  fulfillmentType: MenuItemFulfillmentType;
  description: string | null;
  isAvailable: boolean;
};

export type CreateMenuItemInput = {
  name: string;
  price: number;
  fulfillmentType: MenuItemFulfillmentType;
  description?: string;
};

export class MenuItemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuItemValidationError";
  }
}

function assertValidInput(input: CreateMenuItemInput): void {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new MenuItemValidationError("商品名を入力してください。");
  }
  if (input.name.length > 50) {
    throw new MenuItemValidationError("商品名は50文字以内で入力してください。");
  }
  if (!Number.isSafeInteger(input.price) || input.price <= 0) {
    throw new MenuItemValidationError("金額は1円以上の整数で入力してください。");
  }
  if (input.fulfillmentType !== "brew" && input.fulfillmentType !== "direct") {
    throw new MenuItemValidationError(
      "区分はコーヒー（抽出が必要）かそれ以外（そのまま提供）のいずれかを選択してください。",
    );
  }
}

/**
 * スタッフによる商品登録。
 * fulfillmentType は既存の menu_items.fulfillment_type 列（'brew'|'direct'）をそのまま使う。
 * 'brew' = コーヒー等、ドリップ係の抽出工程を経る商品。
 * 'direct' = それ以外、抽出を経ずそのまま提供する商品。
 * 作成した商品は isAvailable = true（既定値）になるため、
 * 保存直後から order 画面・モバイルオーダーの両方に反映される。
 */
export async function createMenuItem(db: Db, input: CreateMenuItemInput): Promise<MenuItem> {
  assertValidInput(input);

  const item: MenuItem = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    price: input.price,
    fulfillmentType: input.fulfillmentType,
    description: input.description?.trim() || null,
    isAvailable: true,
  };
  await db.insert(menuItems).values({ ...item, isAvailable: 1 });

  return item;
}

/**
 * 販売中/販売停止の切り替え。
 * order画面・モバイルオーダーの両方で、この値を見て表示/非表示を判断する。
 */
export async function setMenuItemAvailability(
  db: Db,
  menuItemId: string,
  isAvailable: boolean,
): Promise<void> {
  const updated = await db
    .update(menuItems)
    .set({ isAvailable: isAvailable ? 1 : 0, updatedAt: getJstNowString() })
    .where(eq(menuItems.id, menuItemId))
    .returning({ id: menuItems.id });
  if (updated.length === 0) {
    throw new MenuItemValidationError("指定された商品が見つかりません。");
  }
}
