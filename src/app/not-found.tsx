import { Sprout } from 'lucide-react';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg, #f8f9f6)', padding: '40px 20px', gap: '20px', textAlign: 'center',
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
      <h2 style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '56px', fontWeight: 800, letterSpacing: '-2px', color: '#293a32', margin: '10px 0' }}>
        404
      </h2>
      <h3 style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '20px', fontWeight: 700, letterSpacing: '-0.5px', color: '#293a32' }}>
        This page isn&apos;t on the menu.
      </h3>
      <p style={{ fontSize: '13px', color: '#8a918a', maxWidth: '380px', lineHeight: 1.65 }}>
        Looks like this page was removed or doesn&apos;t exist. Let&apos;s get you back to something delicious.
      </p>
      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <a href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '11px 20px',
          background: '#426b50', color: '#fff', border: 'none', borderRadius: '8px',
          fontSize: '13px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
        }}>
          Back to home
        </a>
      </div>
    </div>
  );
}
