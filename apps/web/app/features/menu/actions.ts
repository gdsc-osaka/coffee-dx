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
export async function createMenuItem(
  d1: D1Database,
  input: CreateMenuItemInput,
): Promise<MenuItem> {
  assertValidInput(input);

  const id = crypto.randomUUID();
  await d1
    .prepare(
      `INSERT INTO menu_items (id, name, price, fulfillment_type, description, is_available)
       VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .bind(
      id,
      input.name.trim(),
      input.price,
      input.fulfillmentType,
      input.description?.trim() || null,
    )
    .run();

  return {
    id,
    name: input.name.trim(),
    price: input.price,
    fulfillmentType: input.fulfillmentType,
    description: input.description?.trim() || null,
    isAvailable: true,
  };
}

/**
 * 販売中/販売停止の切り替え。
 * order画面・モバイルオーダーの両方で、この値を見て表示/非表示を判断する。
 */
export async function setMenuItemAvailability(
  d1: D1Database,
  menuItemId: string,
  isAvailable: boolean,
): Promise<void> {
  const result = await d1
    .prepare(
      `UPDATE menu_items SET is_available = ?, updated_at = datetime('now', '+9 hours')
       WHERE id = ?`,
    )
    .bind(isAvailable ? 1 : 0, menuItemId)
    .run();
  if (result.meta?.changes === 0) {
    throw new MenuItemValidationError("指定された商品が見つかりません。");
  }
}
