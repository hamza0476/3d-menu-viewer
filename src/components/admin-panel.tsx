'use client';
import { useEffect, useMemo, useState } from 'react';
import { Store, UtensilsCrossed, Eye, ShieldCheck, ShieldAlert, Search, CheckCheck, X, Loader2, Mail, LogOut } from 'lucide-react';
import { Brand, Empty, request } from './ui';

type Row = { id: string; name: string; city: string; province: string; currency: string; published: boolean; suspended: boolean; ownerName: string; ownerEmail: string; ownerVerified: boolean; ownerDemo: boolean; productCount: number; views: number };
type Stats = { restaurants: number; liveMenus: number; suspended: number; items: number; views: number; unverifiedOwners: number };

export default function AdminPanel({ adminName }: { adminName: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await request<{ rows: Row[]; stats: Stats }>('/api/admin/businesses');
      setRows(data.rows);
      setStats(data.stats);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(q) || r.ownerEmail.toLowerCase().includes(q) || r.city.toLowerCase().includes(q));
  }, [rows, search]);

  const toggleSuspend = async (row: Row) => {
    setBusyId(row.id);
    try {
      await request(`/api/admin/businesses/${row.id}`, 'PATCH', { suspended: !row.suspended });
      setToast(row.suspended ? `${row.name} is reinstated.` : `${row.name} has been suspended and taken offline.`);
      await load();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand small />
        <div className="topbar-right">
          <span className="status-pill">Admin · {adminName}</span>
          <a href="/" className="icon-btn" aria-label="Back to your dashboard"><LogOut size={18} /></a>
        </div>
      </header>
      <main className="main-content">
        <div className="page-heading">
          <div><div className="heading-eyebrow"><span>••</span> PLATFORM</div><h1>Platform overview</h1><p>Every restaurant workspace on Platera, at a glance.</p></div>
        </div>
        {error && <div className="error-message" style={{ margin: '0 0 20px' }}>{error}</div>}
        {!rows ? (
          <div className="skeleton skeleton-stat" style={{ marginBottom: 24 }} />
        ) : (
          <>
            <div className="stats-grid">
              <section className="stat-card"><div className="stat-top"><span>Restaurants</span><span className="stat-icon"><Store size={17} strokeWidth={1.7} /></span></div><div className="stat-value-row"><strong>{stats?.restaurants}</strong></div><div className="stat-note"><span className="mini-dot" />{stats?.liveMenus} live</div></section>
              <section className="stat-card"><div className="stat-top"><span>Menu items</span><span className="stat-icon"><UtensilsCrossed size={17} strokeWidth={1.7} /></span></div><div className="stat-value-row"><strong>{stats?.items}</strong></div><div className="stat-note"><span className="mini-dot" />Across all restaurants</div></section>
              <section className="stat-card"><div className="stat-top"><span>All-time views</span><span className="stat-icon"><Eye size={17} strokeWidth={1.7} /></span></div><div className="stat-value-row"><strong>{stats?.views.toLocaleString()}</strong></div><div className="stat-note"><span className="mini-dot" />Guest dish views</div></section>
              <section className="stat-card"><div className="stat-top"><span>Needs attention</span><span className="stat-icon"><ShieldAlert size={17} strokeWidth={1.7} /></span></div><div className="stat-value-row"><strong>{stats?.suspended}</strong></div><div className="stat-note"><span className="mini-dot" />{stats?.unverifiedOwners} owners unverified</div></section>
            </div>
            <section className="panel">
              <div className="section-heading"><div><h2>Restaurants</h2><p>Search, review, and moderate any workspace.</p></div><div className="search-input"><Search size={14} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search restaurant, owner email, city" /></div></div>
              {filtered.length ? (
                <div className="analytics-table admin-table">
                  <div className="table-head"><span>RESTAURANT</span><span>OWNER</span><span>ITEMS · VIEWS</span><span>STATUS</span></div>
                  {filtered.map(r => (
                    <div className="table-row" key={r.id}>
                      <div className="table-dish"><span><strong>{r.name}</strong><small>{r.city}{r.province ? ', ' + r.province : ''} · {r.currency}</small></span></div>
                      <div><small style={{ display: 'block' }}>{r.ownerName}</small><small style={{ display: 'block', marginTop: 3 }}>{r.ownerDemo ? 'Demo account' : r.ownerEmail}</small>{!r.ownerDemo && !r.ownerVerified && <span className="status-pill" style={{ marginTop: 5 }}><Mail size={11} /> unverified</span>}</div>
                      <strong>{r.productCount} · {r.views.toLocaleString()}</strong>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className={'model-status ' + (r.suspended ? '' : r.published ? 'ready' : '')}>{r.suspended ? 'Suspended' : r.published ? 'Live' : 'Unpublished'}</span>
                        <button className={'btn ' + (r.suspended ? '' : 'destructive')} disabled={busyId === r.id} onClick={() => toggleSuspend(r)}>
                          {busyId === r.id ? <Loader2 size={14} className="spin" /> : r.suspended ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                          {r.suspended ? 'Reinstate' : 'Suspend'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No restaurants match" text="Try a different search term." />
              )}
            </section>
            <footer className="page-footer"><span>Platera admin.</span><span>Internal moderation tools.</span></footer>
          </>
        )}
      </main>
      {toast && <div className="toast" role="status" style={{ left: '50%' }}><CheckCheck size={18} />{toast}<button className="icon-btn" onClick={() => setToast('')} aria-label="Dismiss message"><X size={16} /></button></div>}
    </div>
  );
}
