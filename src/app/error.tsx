'use client';
import { useEffect } from 'react';
import { Sprout, AlertTriangle, RefreshCw } from 'lucide-react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg, #f8f9f6)',
      padding: '40px 20px',
      gap: '20px',
      textAlign: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          width: '37px', height: '39px', border: '1.8px solid #34513e',
          borderRadius: '12px 12px 15px 15px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#34513e', transform: 'rotate(-5deg)',
        }}>
          <Sprout size={25} strokeWidth={1.7} />
        </span>
        <span style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '32px', fontWeight: 750, letterSpacing: '-1.6px' }}>
          platera<span style={{ color: '#84a16b' }}>.</span>
        </span>
      </div>
      <div style={{ background: '#fef3cd', border: '1px solid #ffc107', borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', color: '#856404', fontSize: '13px' }}>
        <AlertTriangle size={18} />
        Something went wrong
      </div>
      <h2 style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '22px', fontWeight: 700, letterSpacing: '-0.5px', color: '#293a32' }}>
        A little bump in the road.
      </h2>
      <p style={{ fontSize: '13px', color: '#8a918a', maxWidth: '420px', lineHeight: 1.65 }}>
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <button
        onClick={reset}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 20px',
          background: '#426b50', color: '#fff', border: 'none', borderRadius: '8px',
          fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        }}
      >
        <RefreshCw size={15} /> Try again
      </button>
      <a href="/" style={{ fontSize: '12px', color: '#426b50', textDecoration: 'underline', cursor: 'pointer' }}>
        Return home
      </a>
    </div>
  );
}
