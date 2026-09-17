'use client';
import { useState } from 'react';
import { ArrowRight, Loader2, ShieldCheck, CheckCheck } from 'lucide-react';
import { Brand, request } from './ui';

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  return (
    <div className="guest-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
      <div className="panel" style={{ width: 420, maxWidth: '100%' }}>
        <Brand />
        {!token ? (
          <div className="error-message" style={{ margin: '20px 0 0' }}>This reset link is missing its token. Please use the link from your email, or request a new one.</div>
        ) : done ? (
          <>
            <h2 style={{ marginTop: 20 }}>Password updated</h2>
            <p style={{ fontSize: 12, color: '#8a9b76', marginTop: 8 }}>You're signed in with your new password.</p>
            <a href="/" className="btn primary full" style={{ marginTop: 20 }}><CheckCheck size={16} /> Go to your dashboard</a>
          </>
        ) : (
          <form
            onSubmit={async e => {
              e.preventDefault();
              setError('');
              if (password.length < 8) return setError('Use a password of at least 8 characters.');
              if (password !== confirm) return setError('Passwords do not match.');
              setBusy(true);
              try {
                await request('/api/auth', 'POST', { action: 'reset', token, password });
                setDone(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2 style={{ margin: '20px 0 4px' }}>Choose a new password</h2>
            <p style={{ fontSize: 12, color: '#8a9b76', marginBottom: 17 }}>Make it at least 8 characters.</p>
            <label>New password<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
            <label>Confirm password<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type it again" /></label>
            {error && <div className="error-message">{error}</div>}
            <button className="btn primary full" disabled={busy}>{busy ? <Loader2 size={17} className="spin" /> : <ArrowRight size={17} />} {busy ? 'Saving…' : 'Update password'}</button>
            <p className="secure-note"><ShieldCheck size={15} /> This will sign you out of other devices for your security.</p>
          </form>
        )}
      </div>
    </div>
  );
}
