import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db';
import { memberships, invites, users } from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { hashToken, uid, activity } from '@/lib/auth';
import { requireMembership } from '@/lib/tenancy';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { sendInviteEmail } from '@/lib/email';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Team invites (Phase 6). Owner-only, per the plan's role matrix —
// managers run the menu, they do not decide who joins the restaurant.
// Only manager/staff can be invited: ownership is never transferable
// through an invite. The raw token exists solely in the emailed link
// (and, when no mail provider is configured, in the owner's response so
// they can share the link themselves — the Phase 1 no-fake-email rule);
// the database stores only its SHA-256 hash, like session tokens.
export async function POST(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (membership.role !== 'owner') return NextResponse.json({ error: 'Only the restaurant owner can invite team members.' }, { status: 403 });
  const { user, business } = membership;
  if (!(await rateLimit(`invite:${business.id}`, 20, 3600))) return NextResponse.json({ error: 'Too many invitations sent. Please wait a while and try again.' }, { status: 429 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role === 'manager' || body.role === 'staff' ? body.role : null;
  if (!EMAIL_RE.test(email) || email.length > 254) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (!role) return NextResponse.json({ error: 'Choose a role: manager or staff.' }, { status: 400 });
  if (email === user.email.toLowerCase()) return NextResponse.json({ error: 'You are already the owner of this restaurant.' }, { status: 400 });

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existingUser) {
    const [already] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, existingUser.id), eq(memberships.businessId, business.id)));
    if (already) return NextResponse.json({ error: 'That person is already on your team.' }, { status: 409 });
  }
  // Re-inviting replaces the outstanding invite (the old link dies).
  await db.delete(invites).where(and(eq(invites.email, email), eq(invites.businessId, business.id), isNull(invites.acceptedAt)));

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + INVITE_TTL_MS);
  const [invite] = await db.insert(invites).values({ id: uid(), email, businessId: business.id, role, token: hashToken(token), invitedBy: user.id, expires }).returning();

  const host = req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || (host && (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http' : 'https');
  const url = `${proto}://${host}/invite/${token}`;
  const sent = await sendInviteEmail(email, { inviterName: user.name, businessName: business.name, role, url });
  await activity(business.id, `Invited ${email} to join as ${role}`, 'team');
  await audit({ actorUserId: user.id, actorRole: membership.role, businessId: business.id, action: 'invite.created', targetType: 'invite', targetId: invite.id, metadata: { email, role } });
  // No mail provider configured → hand the owner the link to share
  // themselves instead of pretending an email went out.
  return NextResponse.json({ ok: true, delivered: sent.delivered, inviteUrl: sent.delivered ? undefined : url, expires });
}

// Revoke an outstanding invite (owner-only). The link stops working
// immediately because the row — the only place its hash lives — is gone.
export async function DELETE(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (membership.role !== 'owner') return NextResponse.json({ error: 'Only the restaurant owner can revoke invitations.' }, { status: 403 });
  const { user, business } = membership;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  const [invite] = await db.select().from(invites).where(and(eq(invites.id, id), eq(invites.businessId, business.id)));
  if (!invite) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
  await db.delete(invites).where(eq(invites.id, invite.id));
  await audit({ actorUserId: user.id, actorRole: membership.role, businessId: business.id, action: 'invite.revoked', targetType: 'invite', targetId: invite.id, metadata: { email: invite.email, role: invite.role } });
  return NextResponse.json({ ok: true });
}
