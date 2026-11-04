'use client';
import { useState } from 'react';
import { Loader2, CheckCheck, MailCheck } from 'lucide-react';
import { Brand, request } from './ui';

export default function VerifyEmailForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  return (
    <div className="guest-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
      <div className="panel" style={{ width: 420, maxWidth: '100%' }}>
        <Brand />
        {!token ? (
          <div className="error-message" style={{ margin: '20px 0 0' }}>This verification link is missing its token. Please use the link from your email, or sign in and request a new one.</div>
        ) : done ? (
          <>
            <h2 style={{ marginTop: 20 }}>Email verified</h2>
            <p style={{ fontSize: 12, color: '#8a9b76', marginTop: 8 }}>Thanks — your email address is confirmed and your menu can be published.</p>
            <a href="/dashboard" className="btn primary full" style={{ marginTop: 20 }}><CheckCheck size={16} /> Go to your dashboard</a>
          </>
        ) : (
          <>
            <h2 style={{ margin: '20px 0 4px' }}>Confirm your email</h2>
            <p style={{ fontSize: 12, color: '#8a9b76', marginBottom: 17 }}>One click so we know this inbox is really yours. (Links are confirmed by button, not by opening, so mail scanners can&apos;t use yours up.)</p>
            {error && <div className="error-message">{error}</div>}
            <button
              className="btn primary full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await request('/api/verify', 'POST', { token });
                  setDone(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 size={17} className="spin" /> : <MailCheck size={17} />} {busy ? 'Confirming…' : 'Verify my email'}
            </button>
            <p className="auth-switch">Wrong account? <a href="/">Back to Platera</a></p>
          </>
        )}
      </div>
    </div>
  );
}
