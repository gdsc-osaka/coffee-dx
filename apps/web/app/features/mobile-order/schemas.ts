import { z } from "zod";

export const MAX_MOBILE_ORDER_CUPS = 9;
export const mobileStoreTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
export const mobilePublicTokenSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const mobileIdempotencyKeySchema = z.string().regex(/^[\x21-\x7E]{16,128}$/);
export const mobileOrderAcceptanceIntentSchema = z.enum(["stop", "resume"]);

export const mobileOrderItemInputSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const mobileOrderItemsSchema = z
  .array(mobileOrderItemInputSchema)
  .min(1)
  .superRefine((items, ctx) => {
    const totalCups = items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalCups > MAX_MOBILE_ORDER_CUPS) {
      ctx.addIssue({ code: "custom", message: "1注文あたりの杯数は1〜9杯で指定してください。" });
    }
  });

export const confirmedMobileOrderSchema = z.object({
  publicToken: mobilePublicTokenSchema,
});

const storedCartItemSchema = mobileOrderItemInputSchema.extend({
  name: z.string(),
  price: z.number().finite(),
});

export const pendingMobileOrderSchema = z
  .object({
    idempotencyKey: mobileIdempotencyKeySchema,
    cart: z.array(storedCartItemSchema).min(1),
  })
  .superRefine((order, ctx) => {
    const totalCups = order.cart.reduce((sum, item) => sum + item.quantity, 0);
    if (totalCups > MAX_MOBILE_ORDER_CUPS) {
      ctx.addIssue({ code: "custom", message: "1注文あたりの杯数は1〜9杯で指定してください。" });
    }
  });

export type MobileOrderItemInput = z.infer<typeof mobileOrderItemInputSchema>;
export type ConfirmedMobileOrder = z.infer<typeof confirmedMobileOrderSchema>;
export type PendingMobileOrder = z.infer<typeof pendingMobileOrderSchema>;
