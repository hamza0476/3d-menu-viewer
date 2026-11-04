import { getUser, ownerBusiness } from "./auth";
import type { users, businesses } from "@/db/schema";

export type Membership = {
  user: typeof users.$inferSelect;
  business: typeof businesses.$inferSelect;
};

// The single tenancy seam for authenticated owner routes.
//
// Today Platera has one business per owner, so "membership" is ownership:
// requireMembership() resolves the signed-in user and the business they own,
// or null when either is missing (route handlers turn null into a 401).
// Every owner-scoped handler must go through this helper and scope its
// queries by membership.business.id — never by an id taken from the request.
// When staff roles and multiple businesses land (memberships table), this is
// the only function whose internals change; the handlers stay the same.
export async function requireMembership(): Promise<Membership | null> {
  const user = await getUser();
  if (!user) return null;
  const business = await ownerBusiness();
  if (!business) return null;
  return { user, business };
}
