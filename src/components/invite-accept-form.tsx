'use client';
import { useState } from 'react';
import { Loader2, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { Brand, request } from './ui';

type Props = {
  token: string;
  state: 'invalid' | 'accepted' | 'expired' | 'ok';
  businessName?: string;
  inviterName?: string;
  role?: string;
  inviteEmail?: string;
  signedInEmail?: string | null;
  accountExists?: boolean;
};

export default function InviteAcceptForm({ token, state, businessName, inviterName, role, inviteEmail, signedInEmail, accountExists }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const mismatch = state === 'ok' && signedInEmail && inviteEmail && signedInEmail.toLowerCase() !== inviteEmail.toLowerCase();
  const needsAccount = state === 'ok' && !signedInEmail && !accountExists;

  return (
    <div className="guest-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
      <div className="panel" style={{ width: 420, maxWidth: '100%' }}>
        <Brand />
        {state === 'invalid' && <div className="error-message" style={{ margin: '20px 0 0' }}>This invitation link is invalid. Ask the restaurant owner to send a new one.</div>}
        {state === 'accepted' && (
          <>
            <h2 style={{ marginTop: 20 }}>Already accepted</h2>
            <p style={{ fontSize: 12, color: '#8a9b76', marginTop: 8 }}>This invitation has already been used. Sign in to open the restaurant workspace.</p>
            <Link href="/dashboard" className="btn primary full" style={{ marginTop: 20 }}><Users size={16} /> Go to the dashboard</Link>
          </>
        )}
        {state === 'expired' && <div className="error-message" style={{ margin: '20px 0 0' }}>This invitation has expired. Ask the restaurant owner to send a new one.</div>}
        {state === 'ok' && (
          <>
            <h2 style={{ margin: '20px 0 4px' }}>Join {businessName}</h2>
            <p style={{ fontSize: 12, color: '#8a9b76', marginBottom: 17 }}>{inviterName} invited <b>{inviteEmail}</b> to help run this restaurant as a <b>{role}</b>.</p>
            {mismatch && <div className="error-message">You are signed in as {signedInEmail}, but this invitation was sent to {inviteEmail}. Sign out, then open this link again.</div>}
            {!mismatch && signedInEmail && <p style={{ fontSize: 12, color: '#8a9b76', marginBottom: 12 }}>You are signed in as {signedInEmail}.</p>}
            {!mismatch && !signedInEmail && accountExists && (
              <div className="error-message">You already have a Platera account for {inviteEmail}. <Link href="/">Sign in</Link>, then open this link again to accept.</div>
            )}
            {needsAccount && (
              <>
                <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ayesha Khan" autoComplete="name" /></label>
                <label>Create a password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" autoComplete="new-password" /></label>
              </>
            )}
            {error && <div className="error-message">{error}</div>}
            {!mismatch && !(state === 'ok' && !signedInEmail && accountExists) && (
              <button
                className="btn primary full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await request('/api/invites/accept', 'POST', needsAccount ? { token, name, password } : { token });
                    window.location.assign('/dashboard');
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                {busy ? <Loader2 size={17} className="spin" /> : <UserPlus size={17} />} {busy ? 'Joining…' : 'Accept invitation'}
              </button>
            )}
            <p className="auth-switch">Not for you? Just close this page — nothing happens until you accept.</p>
          </>
        )}
      </div>
    </div>
  );
}
