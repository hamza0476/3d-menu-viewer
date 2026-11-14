import { NextResponse } from 'next/server';
import { db } from '@/db';
import { invites, memberships, users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getUser, hashPassword, hashToken, setSession, uid, activity } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { passwordProblem } from '@/lib/password-policy';

// Accepting an invite (Phase 6). The token in the link is the credential
// — only its hash is stored — and POST is the only consuming verb (the
// GET page in /invite/[token] merely renders a confirmation, so mail
// scanners prefetching the link cannot burn it; the Phase 1 pattern).
//
// Who can accept: the person the invite was emailed to. If they are
// signed in, their account email must match. If they have an account but
// are signed out, they sign in first (we never silently merge accounts).
// If they have no account, this creates one — with the same password
// policy + breach check as registration — and the invite itself stands
// in for email verification, since it was delivered to that inbox.
export async function POST(req: Request) {
  if (!(await rateLimit(`invite-accept:${clientIp(req)}`, 10, 600))) return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) return NextResponse.json({ error: 'This invitation link is invalid.' }, { status: 400 });
  const [invite] = await db.select().from(invites).where(eq(invites.token, hashToken(token)));
  if (!invite) return NextResponse.json({ error: 'This invitation link is invalid.' }, { status: 400 });
  if (invite.acceptedAt) return NextResponse.json({ error: 'This invitation has already been accepted.' }, { status: 400 });
  if (invite.expires.getTime() < Date.now()) return NextResponse.json({ error: 'This invitation has expired. Ask the restaurant owner to send a new one.' }, { status: 400 });

  let user = await getUser();
  if (user && user.email.toLowerCase() !== invite.email) {
    return NextResponse.json({ error: `This invitation was sent to ${invite.email}, but you are signed in with a different email. Sign out and open the link again.` }, { status: 403 });
  }
  if (!user) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, invite.email));
    if (existing) return NextResponse.json({ error: 'You already have a Platera account. Sign in, then open this invitation link again.' }, { status: 401 });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name) return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });
    const problem = await passwordProblem(password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const [created] = await db.insert(users).values({ id: uid(), name: name.slice(0, 100), email: invite.email, password: await hashPassword(password), demo: false, emailVerified: true }).returning();
    user = created;
    await setSession(user.id);
  }

  const [already] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.businessId, invite.businessId)));
  if (!already) {
    await db.insert(memberships).values({ id: uid(), userId: user.id, businessId: invite.businessId, role: invite.role, invitedBy: invite.invitedBy });
  }
  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
  await activity(invite.businessId, `${user.name} joined the team as ${invite.role}`, 'team');
  await audit({ actorUserId: user.id, actorRole: invite.role, businessId: invite.businessId, action: 'invite.accepted', targetType: 'invite', targetId: invite.id, metadata: { email: invite.email, role: invite.role } });
  return NextResponse.json({ ok: true, businessId: invite.businessId, alreadyMember: Boolean(already) });
}
