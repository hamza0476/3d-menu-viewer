'use client';
import { useState } from 'react';
import { Sprout, Box, QrCode, Eye, ArrowRight, UtensilsCrossed, Utensils, Camera, Store } from 'lucide-react';
import AuthForm from './auth-form';

export default function Landing() {
  const [auth, setAuth] = useState(false);
  const [foodLoading, setFoodLoading] = useState(false);

  async function goToFood() {
    setFoodLoading(true);
    try {
      const res = await fetch('/api/menu/first');
      const data = await res.json();
      if (data.id) window.location.href = '/menu/' + data.id;
    } catch {}
    setFoodLoading(false);
  }
  const features = [
    { icon: Box, title: '3D Menu Experience', desc: 'Let guests explore your dishes in immersive 3D before ordering. Upload GLB models or use our built-in illustrative previews.' },
    { icon: QrCode, title: 'Instant QR Codes', desc: 'Generate and download your restaurant QR code. Guests scan, explore, and discover your menu — no app needed.' },
    { icon: Eye, title: 'Real-Time Analytics', desc: 'Track views, popular dishes, and guest engagement. Export CSV reports for deeper insights.' },
    { icon: Camera, title: 'Multi-Angle Capture', desc: 'Upload up to 16 photos per dish. Capture angles directly from your phone camera for a complete visual.' },
    { icon: UtensilsCrossed, title: 'Live Menu Management', desc: 'Add, edit, or remove dishes instantly. Toggle availability. Your menu updates everywhere in real time.' },
    { icon: Store, title: 'Beautiful Restaurant Profile', desc: 'Showcase your restaurant with a polished profile. Address, tagline, phone — all in one place.' },
  ];
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f8f9f6)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '26px', fontWeight: 750, letterSpacing: '-1.4px' }}>
          <span style={{ width: '33px', height: '35px', border: '1.8px solid #34513e', borderRadius: '10px 10px 13px 13px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34513e', transform: 'rotate(-5deg)' }}>
            <Sprout size={22} strokeWidth={1.7} />
          </span>
          platera<span style={{ color: '#84a16b' }}>.</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={() => setAuth(true)} style={{ padding: '10px 18px', background: '#426b50', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px' }}>
            Open workspace <ArrowRight size={15} />
          </button>
        </div>
      </header>

      <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 40px 80px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '60px', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '9px', letterSpacing: '2px', color: '#426b50', fontWeight: 700, marginBottom: '16px', textTransform: 'uppercase' }}>
            Your restaurant, reimagined
          </div>
          <h1 style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '48px', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1.1, color: '#293a32', margin: '0 0 20px' }}>
            A little more<br />than a menu.
          </h1>
          <p style={{ fontSize: '15px', color: '#8a918a', lineHeight: 1.7, maxWidth: '460px', margin: '0 0 30px' }}>
            Turn your restaurant menu into an interactive 3D experience. Let guests explore every dish from every angle. Manage everything from one beautiful workspace.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button onClick={() => setAuth(true)} style={{ padding: '14px 24px', background: '#426b50', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 650, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              Get started free <ArrowRight size={17} />
            </button>
            <a href="#features" style={{ padding: '14px 24px', background: '#fff', color: '#293a32', border: '1px solid #e8ebe4', borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
              See features
            </a>
            <button onClick={goToFood} disabled={foodLoading} style={{ padding: '14px 24px', background: '#fff', color: '#426b50', border: '1px solid #c5d6bc', borderRadius: '10px', fontSize: '14px', fontWeight: 650, cursor: foodLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: foodLoading ? 0.7 : 1 }}>
              <Utensils size={17} /> I'm here for the food
            </button>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e8ebe4', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,.06)' }}>
            <img src="/images/menu-hero.jpg" alt="Fresh restaurant dish" style={{ width: '100%', height: '280px', objectFit: 'cover' }} />
            <div style={{ padding: '24px' }}>
              <div style={{ fontSize: '9px', letterSpacing: '1.5px', color: '#426b50', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Featured dish</div>
              <h3 style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '18px', fontWeight: 700, margin: '0 0 6px' }}>Avocado & grain bowl</h3>
              <p style={{ fontSize: '12px', color: '#8a918a', margin: '0 0 12px', lineHeight: 1.6 }}>A feel-good bowl of creamy avocado, quinoa, roasted chickpeas and seasonal greens.</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '16px', color: '#293a32' }}>$16.50</strong>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#eef3e9', color: '#426b50', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>
                  <Box size={13} /> 3D ready
                </span>
              </div>
            </div>
          </div>
          <div style={{ position: 'absolute', top: '-16px', right: '-16px', background: '#426b50', color: '#fff', padding: '10px 14px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 16px rgba(66,107,80,.3)' }}>
            <QrCode size={15} /> QR Menu
          </div>
        </div>
      </section>

      <section id="features" style={{ background: '#fff', borderTop: '1px solid #e8ebe4', borderBottom: '1px solid #e8ebe4' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '50px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '2px', color: '#426b50', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase' }}>Everything you need</div>
            <h2 style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '28px', fontWeight: 750, letterSpacing: '-1px', color: '#293a32', margin: '0 0 10px' }}>
              Built for modern restaurants
            </h2>
            <p style={{ fontSize: '13px', color: '#8a918a', maxWidth: '500px', margin: '0 auto' }}>
              From 3D dish previews to QR menus and analytics — everything in one elegant workspace.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {features.map((f) => (
              <div key={f.title} style={{ background: '#f8f9f6', borderRadius: '12px', padding: '28px 24px', border: '1px solid #e8ebe4' }}>
                <div style={{ width: '40px', height: '40px', background: '#eef3e9', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#426b50', marginBottom: '16px' }}>
                  <f.icon size={20} />
                </div>
                <h3 style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '15px', fontWeight: 700, margin: '0 0 8px', color: '#293a32' }}>{f.title}</h3>
                <p style={{ fontSize: '12px', color: '#8a918a', lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 40px 80px', textAlign: 'center' }}>
        <h2 style={{ fontFamily: "'Manrope', 'DM Sans', sans-serif", fontSize: '28px', fontWeight: 750, letterSpacing: '-1px', color: '#293a32', margin: '0 0 12px' }}>
          Ready to bring your menu to life?
        </h2>
        <p style={{ fontSize: '13px', color: '#8a918a', maxWidth: '400px', margin: '0 auto 28px' }}>
          Start with a free demo workspace. No credit card required.
        </p>
        <button onClick={() => setAuth(true)} style={{ padding: '14px 28px', background: '#426b50', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 650, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          Open your workspace <ArrowRight size={17} />
        </button>
      </section>

      <footer style={{ borderTop: '1px solid #e8ebe4', padding: '24px 40px', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8a918a' }}>
        <Sprout size={14} /> A little more than a menu.
      </footer>

      {auth && <AuthForm menuId="" onClose={() => setAuth(false)} onSuccess={() => { window.location.reload(); }} />}
    </div>
  );
}
