import { NextResponse } from 'next/server';
import { db } from '@/db';
import { memberships, invites, users } from '@/db/schema';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { requireMembership } from '@/lib/tenancy';

// The signed-in member's team view: everyone with a membership in this
// restaurant, plus the invites still outstanding. Any member may READ
// the team (they need to know who they work with); every mutation is
// owner-only and lives in the invites/members routes below.
export async function GET() {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const business = membership.business;
  const members = await db
    .select({ membershipId: memberships.id, userId: users.id, name: users.name, email: users.email, role: memberships.role, joinedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.businessId, business.id))
    .orderBy(asc(memberships.createdAt));
  const pending = await db
    .select({ id: invites.id, email: invites.email, role: invites.role, expires: invites.expires, createdAt: invites.createdAt })
    .from(invites)
    .where(and(eq(invites.businessId, business.id), isNull(invites.acceptedAt), gt(invites.expires, new Date())))
    .orderBy(asc(invites.createdAt));
  return NextResponse.json({ role: membership.role, members, invites: pending });
}
