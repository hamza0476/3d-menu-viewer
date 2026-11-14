import { NextResponse } from 'next/server';
import { db } from '@/db';
import { memberships } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { revokeSessions } from '@/lib/auth';
import { requireMembership } from '@/lib/tenancy';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ userId: string }> };

// Role changes and removals (Phase 6, plan §6). Owner-only. The owner's
// own membership can neither be demoted nor removed through here — the
// restaurant always keeps its owner — and both actions revoke the
// member's sessions so a demotion or removal takes effect on their very
// next request, not whenever their cookie happens to expire.
async function guard(ctx: Ctx) {
  const membership = await requireMembership();
  if (!membership) return { error: NextResponse.json({ error: 'Please sign in.' }, { status: 401 }) };
  if (membership.role !== 'owner') return { error: NextResponse.json({ error: 'Only the restaurant owner can manage the team.' }, { status: 403 }) };
  const { userId } = await ctx.params;
  const [target] = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.businessId, membership.business.id)));
  if (!target) return { error: NextResponse.json({ error: 'Team member not found.' }, { status: 404 }) };
  if (target.role === 'owner') return { error: NextResponse.json({ error: "The restaurant owner's role cannot be changed." }, { status: 400 }) };
  return { membership, target };
}

export async function PATCH(req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ('error' in g) return g.error;
  const { membership, target } = g;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const role = body.role === 'manager' || body.role === 'staff' ? body.role : null;
  if (!role) return NextResponse.json({ error: 'Choose a role: manager or staff.' }, { status: 400 });
  if (target.role === role) return NextResponse.json({ ok: true, unchanged: true });
  await db.update(memberships).set({ role }).where(eq(memberships.id, target.id));
  await revokeSessions(target.userId);
  await audit({ actorUserId: membership.user.id, actorRole: membership.role, businessId: membership.business.id, action: 'member.role_changed', targetType: 'user', targetId: target.userId, metadata: { from: target.role, to: role } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ('error' in g) return g.error;
  const { membership, target } = g;
  await db.delete(memberships).where(eq(memberships.id, target.id));
  await revokeSessions(target.userId);
  await audit({ actorUserId: membership.user.id, actorRole: membership.role, businessId: membership.business.id, action: 'member.removed', targetType: 'user', targetId: target.userId, metadata: { role: target.role } });
  return NextResponse.json({ ok: true });
}
