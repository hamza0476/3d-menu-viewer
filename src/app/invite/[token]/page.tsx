import { db } from '@/db';
import { invites, businesses, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hashToken, getUser } from '@/lib/auth';
import InviteAcceptForm from '@/components/invite-accept-form';

// Invitation landing page (Phase 6). GET only READS — accepting happens
// through the form's POST — so a mail scanner prefetching this link can
// never consume the invitation (the Phase 1 verify pattern).
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite] = token ? await db.select().from(invites).where(eq(invites.token, hashToken(token))) : [];
  if (!invite) return <InviteAcceptForm token={token} state="invalid" />;
  if (invite.acceptedAt) return <InviteAcceptForm token={token} state="accepted" />;
  // eslint-disable-next-line react-hooks/purity -- server component: invite expiry is meant to be evaluated fresh on every request
  if (invite.expires.getTime() < Date.now()) return <InviteAcceptForm token={token} state="expired" />;
  const [business] = await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, invite.businessId));
  const [inviter] = await db.select({ name: users.name }).from(users).where(eq(users.id, invite.invitedBy));
  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.email, invite.email));
  const user = await getUser();
  return (
    <InviteAcceptForm
      token={token}
      state="ok"
      businessName={business?.name || 'a restaurant'}
      inviterName={inviter?.name || 'The owner'}
      role={invite.role}
      inviteEmail={invite.email}
      signedInEmail={user ? user.email : null}
      accountExists={Boolean(account)}
    />
  );
}
