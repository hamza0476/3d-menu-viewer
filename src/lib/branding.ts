import { db } from "@/db";
import { assets } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

// Phase 5: the book cover's branding. Owners upload logo/cover images
// through the Phase 2 asset pipeline (kind 'logo' / 'cover', attached to
// their business at upload time); the newest ready asset of each kind is
// the restaurant's current branding. URLs go through the asset route,
// whose published rule (extended in this phase) serves logo/cover
// publicly exactly while the business is published and not suspended —
// the same rule, the same revocation, as dish photos.
export type BusinessBranding = { logo: string | null; cover: string | null };

export async function getBusinessBranding(businessId: string): Promise<BusinessBranding> {
  const rows = await db
    .select({ id: assets.id, kind: assets.kind })
    .from(assets)
    .where(and(eq(assets.businessId, businessId), eq(assets.status, "ready")))
    .orderBy(desc(assets.createdAt));
  const url = (kind: string) => {
    const row = rows.find((r) => r.kind === kind);
    return row ? "/api/assets/" + row.id : null;
  };
  return { logo: url("logo"), cover: url("cover") };
}
