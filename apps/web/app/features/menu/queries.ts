import { eq, inArray } from "drizzle-orm";
import { menuItems } from "../../../db/schema";
import { createDb } from "../../lib/db";

type Db = ReturnType<typeof createDb>;

export async function getAvailableMenuItems(db: Db) {
  return db.select().from(menuItems).where(eq(menuItems.isAvailable, 1));
}

export async function getMenuItemsByIds(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(menuItems).where(inArray(menuItems.id, ids));
}
