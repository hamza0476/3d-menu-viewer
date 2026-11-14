import { db } from "@/db";
import { itemModels, products } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { Model3d } from "@/lib/demo";

type ProductRow = typeof products.$inferSelect;

// Phase 4: attach the processed-model bundle (poster / low / high / USDZ)
// to product rows for guest payloads — used by both the guest menu page
// (server component) and GET /api/menu/[id], so the two can never drift.
// Only 'ready' pipeline runs contribute a bundle, and only variant URLs
// are exposed — the source asset is never handed to guests from here
// (product.model remains the classic viewer's own field).
export async function attachModelBundles<T extends ProductRow>(items: T[]): Promise<(T & { model3d: Model3d | null })[]> {
  const itemIds = items.map((i) => i.id);
  const models = itemIds.length
    ? await db.select().from(itemModels).where(and(inArray(itemModels.itemId, itemIds), eq(itemModels.status, "ready")))
    : [];
  const byItem = new Map(models.map((m) => [m.itemId, m]));
  const url = (assetId: string | null) => (assetId ? "/api/assets/" + assetId : null);
  return items.map((item) => {
    const m = byItem.get(item.id);
    return {
      ...item,
      model3d: m
        ? { poster: url(m.posterAssetId), low: url(m.lowAssetId), high: url(m.highAssetId), usdz: url(m.usdzAssetId), lowBytes: m.lowBytes, highBytes: m.highBytes }
        : null,
    };
  });
}
