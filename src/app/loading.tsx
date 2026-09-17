'use client';
import { Sprout, Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg, #f8f9f6)',
      gap: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          width: '37px',
          height: '39px',
          border: '1.8px solid #34513e',
          borderRadius: '12px 12px 15px 15px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#34513e',
          transform: 'rotate(-5deg)',
        }}>
          <Sprout size={25} strokeWidth={1.7} />
        </span>
        <span style={{
          fontFamily: "'Manrope', 'DM Sans', sans-serif",
          fontSize: '32px',
          fontWeight: 750,
          letterSpacing: '-1.6px',
        }}>
          platera<span style={{ color: '#84a16b' }}>.</span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--muted, #8a918a)' }}>
        <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '13px' }}>Loading your workspace...</span>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
