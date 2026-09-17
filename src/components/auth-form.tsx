'use client';
import { useState } from 'react';
import { ArrowRight, Store, Utensils, Loader2, ShieldCheck, MailCheck } from 'lucide-react';
import { Modal, Brand, request } from './ui';

export default function AuthForm({ onClose, onSuccess, menuId }: { onClose: () => void; onSuccess: () => void; menuId: string }) {
  const [role, setRole] = useState<'choose' | 'owner'>('choose');
  const [view, setView] = useState<'login' | 'register' | 'forgot'>('login');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const title = role === 'choose' ? 'A seat for everyone.' : view === 'login' ? 'Welcome back.' : view === 'register' ? 'Make it your own.' : 'Reset your password.';
  const subtitle = role === 'choose' ? 'How would you like to experience Platera?' : view === 'forgot' ? "We'll email you a link to get back in." : 'Your restaurant. Your menu. A whole new dimension.';

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <div className="form-body">
        <Brand />
        {role === 'choose' ? (
          <div className="role-options">
            <button onClick={() => setRole('owner')}><Store size={26} /><span><strong>I’m a restaurant owner</strong><small>Create an account or manage your business.</small></span><ArrowRight size={19} /></button>
            <a href={'/menu/' + menuId}><Utensils size={26} /><span><strong>I’m here for the food</strong><small>Explore the menu. No account needed.</small></span><ArrowRight size={19} /></a>
          </div>
        ) : view === 'forgot' ? (
          sent ? (
            <div className="form-body" style={{ padding: '10px 0 0' }}>
              <div className="info-note"><MailCheck size={18} /><p>If an account exists for that email, a reset link is on its way. It expires in 1 hour.</p></div>
              <button type="button" className="btn full" style={{ marginTop: 14 }} onClick={() => { setSent(false); setView('login'); }}>Back to sign in</button>
            </div>
          ) : (
            <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); const form = new FormData(e.currentTarget); try { await request('/api/auth', 'POST', { action: 'forgot', email: form.get('email') }); setSent(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
              <label>Email address<input name="email" type="email" required placeholder="alex@yourrestaurant.com" autoComplete="email" /></label>
              {error && <div className="error-message">{error}</div>}
              <button className="btn primary full" disabled={busy}>{busy ? <Loader2 size={17} className="spin" /> : <ArrowRight size={17} />} {busy ? 'Sending…' : 'Send reset link'}</button>
              <p className="auth-switch">Remembered it? <button type="button" onClick={() => { setView('login'); setError(''); }}>Sign in</button></p>
            </form>
          )
        ) : (
          <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); const form = new FormData(e.currentTarget); try { await request('/api/auth', 'POST', { action: view, name: form.get('name'), email: form.get('email'), password: form.get('password') }); onSuccess(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
            {view === 'register' && <label>Your full name<input name="name" required placeholder="Alex Morgan" autoComplete="name" /></label>}
            <label>Email address<input name="email" type="email" required placeholder="alex@yourrestaurant.com" autoComplete="email" /></label>
            <label>Password<input name="password" type="password" minLength={8} maxLength={128} required placeholder="At least 8 characters" autoComplete={view === 'login' ? 'current-password' : 'new-password'} /></label>
            {view === 'login' && <p className="auth-switch" style={{ margin: '-9px 0 17px', textAlign: 'right' }}><button type="button" onClick={() => { setView('forgot'); setError(''); }}>Forgot password?</button></p>}
            {error && <div className="error-message">{error}</div>}
            <button className="btn primary full" disabled={busy}>{busy ? <Loader2 size={17} className="spin" /> : <ArrowRight size={17} />} {busy ? 'Please wait…' : view === 'login' ? 'Sign in' : 'Create your account'}</button>
            <p className="auth-switch">{view === 'login' ? 'New to Platera?' : 'Already have an account?'} <button type="button" onClick={() => { setView(view === 'login' ? 'register' : 'login'); setError(''); }}>{view === 'login' ? 'Create an account' : 'Sign in'}</button></p>
            <p className="secure-note"><ShieldCheck size={15} /> {view === 'login' ? 'Your workspace is securely saved.' : 'Keep all your demo edits when you create an account.'}</p>
          </form>
        )}
      </div>
    </Modal>
  );
}
