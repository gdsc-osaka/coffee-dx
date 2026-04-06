import { eq } from "drizzle-orm";
import { menuItems } from "../../../db/schema";
import type { createDb } from "../../lib/db";

type Db = ReturnType<typeof createDb>;

export async function getAvailableMenuItems(db: Db) {
  return db.select().from(menuItems).where(eq(menuItems.isAvailable, 1));
}
