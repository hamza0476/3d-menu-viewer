'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, MailPlus, Trash2, Users, X } from 'lucide-react';
import { Empty, request } from './ui';

type Member = { membershipId: string; userId: string; name: string; email: string; role: 'owner' | 'manager' | 'staff'; joinedAt: string };
type Invite = { id: string; email: string; role: string; expires: string; createdAt: string };
type TeamData = { role: 'owner' | 'manager' | 'staff'; members: Member[]; invites: Invite[] };

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };
const ROLE_NOTE: Record<string, string> = {
  owner: 'Everything — menu, team, billing and settings.',
  manager: 'Menu, QR codes and analytics. No team management or billing.',
  staff: 'Dish availability only — mark dishes live or hidden.',
};

// Team management (Phase 6). Everyone on the team can see who is who;
// inviting, re-roling and removing are owner-only, matching the API —
// the panel simply doesn't render controls the API would refuse.
export default function TeamPanel({ role, selfEmail }: { role: 'owner' | 'manager' | 'staff'; selfEmail: string }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'staff'>('staff');
  const [busy, setBusy] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const isOwner = role === 'owner';

  const load = useCallback(async () => {
    try { setData(await request<TeamData>('/api/team')); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    let live = true;
    request<TeamData>('/api/team')
      .then((d) => { if (live) { setData(d); setError(''); } })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy('invite'); setInviteLink(''); setToast('');
    try {
      const res = await request<{ delivered: boolean; inviteUrl?: string }>('/api/team/invites', 'POST', { email: email.trim(), role: inviteRole });
      setEmail('');
      if (res.delivered) setToast('Invitation sent. They will get an email with their link.');
      else if (res.inviteUrl) { setInviteLink(res.inviteUrl); setToast('Email is not configured on this server, so no email was sent — share this link with them instead. It expires in 7 days.'); }
      await load();
    } catch (err) { setToast((err as Error).message); } finally { setBusy(''); }
  }

  async function changeRole(member: Member, next: string) {
    if (next === member.role) return;
    setBusy(member.userId);
    try { await request(`/api/team/members/${member.userId}`, 'PATCH', { role: next }); setToast(`${member.name} is now ${ROLE_LABEL[next].toLowerCase()}. Their existing sessions were signed out.`); await load(); }
    catch (err) { setToast((err as Error).message); } finally { setBusy(''); }
  }

  async function remove(member: Member) {
    setBusy(member.userId);
    try { await request(`/api/team/members/${member.userId}`, 'DELETE'); setToast(`${member.name} was removed from the team.`); await load(); }
    catch (err) { setToast((err as Error).message); } finally { setBusy(''); }
  }

  async function revoke(inviteRow: Invite) {
    setBusy(inviteRow.id);
    try { await request('/api/team/invites', 'DELETE', { id: inviteRow.id }); setToast('Invitation revoked — that link no longer works.'); await load(); }
    catch (err) { setToast((err as Error).message); } finally { setBusy(''); }
  }

  return (
    <div>
      <section className="panel">
        <div className="section-heading"><div><h2>Your team</h2><p>Everyone who helps run this restaurant on Platera.</p></div><Users size={22} /></div>
        <div className="info-note" style={{ marginBottom: 14 }}><Users size={18} /><p><strong>You are the {ROLE_LABEL[role].toLowerCase()}.</strong> {ROLE_NOTE[role]}</p></div>
        {error && <div className="error-message">{error}</div>}
        {!data ? <div className="loading-caption"><Loader2 size={16} className="spin" /> Loading your team…</div> : (
          <div className="analytics-table admin-table">
            <div className="table-head"><span>MEMBER</span><span>ROLE</span><span>JOINED</span><span>{isOwner ? 'ACTIONS' : ''}</span></div>
            {data.members.map(m => (
              <div className="table-row" key={m.membershipId}>
                <div className="table-dish"><span><strong>{m.name}{m.email === selfEmail ? ' (you)' : ''}</strong><small>{m.email}</small></span></div>
                <div>{isOwner && m.role !== 'owner' ? (
                  <select value={m.role} disabled={busy === m.userId} onChange={e => void changeRole(m, e.target.value)} aria-label={`Role for ${m.name}`}>
                    <option value="manager">Manager</option>
                    <option value="staff">Staff</option>
                  </select>
                ) : <span className="status-pill">{ROLE_LABEL[m.role]}</span>}</div>
                <small>{new Date(m.joinedAt).toLocaleDateString()}</small>
                <div>{isOwner && m.role !== 'owner' && (
                  <button className="btn destructive" disabled={busy === m.userId} onClick={() => void remove(m)}>{busy === m.userId ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Remove</button>
                )}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {isOwner && (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="section-heading"><div><h2>Invite a teammate</h2><p>They get an email link, create their account (or sign in), and land in this workspace with the role you choose.</p></div><MailPlus size={22} /></div>
          <form onSubmit={invite} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ flex: '1 1 240px' }}>Email address<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@example.com" /></label>
            <label>Role<select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'manager' | 'staff')}><option value="manager">Manager</option><option value="staff">Staff</option></select></label>
            <button className="btn primary" disabled={busy === 'invite'}>{busy === 'invite' ? <Loader2 size={15} className="spin" /> : <MailPlus size={15} />} Send invite</button>
          </form>
          {inviteLink && <div className="info-note" style={{ marginTop: 12 }}><MailPlus size={18} /><p style={{ wordBreak: 'break-all' }}>{inviteLink}</p></div>}
          {data && data.invites.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, marginBottom: 8 }}>Waiting to accept</h3>
              {data.invites.map(inv => (
                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid #e6ebdd' }}>
                  <span style={{ fontSize: 12 }}>{inv.email} · {ROLE_LABEL[inv.role]} · expires {new Date(inv.expires).toLocaleDateString()}</span>
                  <button className="btn" disabled={busy === inv.id} onClick={() => void revoke(inv)}>{busy === inv.id ? <Loader2 size={13} className="spin" /> : <X size={13} />} Revoke</button>
                </div>
              ))}
            </div>
          )}
          {data && data.invites.length === 0 && <p className="field-hint" style={{ marginTop: 12 }}>No invitations are waiting right now.</p>}
        </section>
      )}
      {toast && <div className="toast" role="status" style={{ left: '50%' }}>{toast}<button className="icon-btn" onClick={() => setToast('')} aria-label="Dismiss message"><X size={16} /></button></div>}
      {!data && !error && <Empty title="Loading" text="One moment." />}
    </div>
  );
}
