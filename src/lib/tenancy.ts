import { db } from "@/db";
import { businesses, memberships } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getUser, ownerBusiness } from "./auth";
import type { users, businesses as businessesTable } from "@/db/schema";

export type Role = "owner" | "manager" | "staff";

// The role ladder (master plan §6): owner = everything incl. billing &
// team; manager = menu / QR / analytics, no billing, no team management;
// staff = dish availability only. roleAllowed(role, min) is the single
// comparison every route uses — no route re-implements the ordering.
export const ROLE_RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };
export function roleAllowed(role: Role, minRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export type Membership = {
  user: typeof users.$inferSelect;
  business: typeof businessesTable.$inferSelect;
  role: Role;
};

// The single tenancy seam for authenticated owner routes.
//
// Phase 6: membership now resolves through the `memberships` table — the
// seam Phase 1 built for exactly this. A signed-in user lands in the
// restaurant they OWN when they hold one (single-restaurant workspaces
// are the v1 shape), otherwise in their earliest membership — which is
// how an invited manager/staff member, who owns no restaurant, reaches
// the team they joined. Handlers scope every query by
// membership.business.id, never by an id taken from the request, and
// check membership.role for anything beyond basic access.
//
// Fallback: a business with no membership row (impossible after
// migration 0005's backfill + seed-time inserts, but cheap to keep safe)
// still resolves for its owner with role 'owner' — the pre-Phase-6
// behaviour — so a data gap can never lock an owner out of their own
// restaurant.
export async function requireMembership(): Promise<Membership | null> {
  const user = await getUser();
  if (!user) return null;
  const rows = await db
    .select({ business: businesses, role: memberships.role })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(eq(memberships.userId, user.id))
    .orderBy(asc(memberships.createdAt));
  if (rows.length) {
    const owned = rows.find((r) => r.business.ownerId === user.id);
    const pick = owned ?? rows[0];
    return { user, business: pick.business, role: pick.role as Role };
  }
  const business = await ownerBusiness();
  if (!business) return null;
  return { user, business, role: "owner" };
}
