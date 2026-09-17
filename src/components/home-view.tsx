'use client';
import { useEffect, useState } from 'react';
import Dashboard from './dashboard';
import Landing from './landing';

export default function HomeView() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [initialToast, setInitialToast] = useState('');

  useEffect(() => {
    fetch('/api/session').then(r => r.json()).then(d => setHasSession(d.authenticated)).catch(() => setHasSession(false));
    const params = new URLSearchParams(window.location.search);
    if (params.has('verified')) {
      setInitialToast(params.get('verified') === '1' ? 'Your email is verified. Thanks!' : 'That verification link is invalid or has expired.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  if (hasSession === null) return null;

  return hasSession ? <Dashboard initialToast={initialToast} /> : <Landing />;
}
