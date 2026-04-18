import { z } from "zod";

export const cartItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.int().positive(),
});

export type CartItemInput = z.infer<typeof cartItemSchema>;

const safeJsonParse = (s: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
};

export const cartJsonSchema = z.string().transform((s, ctx) => {
  const json = safeJsonParse(s);
  if (!json.ok) {
    ctx.addIssue({ code: "custom", message: "カートデータが不正です" });
    return z.NEVER;
  }
  const result = z.array(cartItemSchema).min(1, "カートが空です").safeParse(json.value);
  if (!result.success) {
    ctx.addIssue({
      code: "custom",
      message: result.error.issues[0]?.message ?? "カートデータが不正です",
    });
    return z.NEVER;
  }
  return result.data;
});
