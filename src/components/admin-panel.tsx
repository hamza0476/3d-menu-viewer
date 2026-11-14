'use client';
import { useCallback, useEffect, useState } from 'react';
import { Store, UtensilsCrossed, Eye, ShieldCheck, ShieldAlert, Search, CheckCheck, X, Loader2, Mail, LogOut, ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Brand, Empty, request } from './ui';

type Row = { id: string; name: string; city: string; province: string; currency: string; published: boolean; suspended: boolean; ownerName: string; ownerEmail: string; ownerVerified: boolean; ownerDemo: boolean; productCount: number; views: number };
type Stats = { restaurants: number; liveMenus: number; suspended: number; items: number; views: number; unverifiedOwners: number };
type AuditRow = { id: string; action: string; actorRole: string; actorEmail: string | null; actorName: string | null; businessName: string | null; targetType: string | null; metadata: Record<string, unknown> | null; createdAt: string };

const PAGE_SIZE = 25;

// Platform admin (Phase 6: server-side pagination + search on the
// restaurant list, and the audit log viewer). Both lists page on the
// server — the panel never downloads the whole platform to render it.
export default function AdminPanel({ adminName }: { adminName: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);

  const load = useCallback(async (p: number, q: string) => {
    try {
      const data = await request<{ rows: Row[]; stats: Stats; total: number }>(`/api/admin/businesses?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}&q=${encodeURIComponent(q)}`);
      setRows(data.rows);
      setStats(data.stats);
      setTotal(data.total);
      setPage(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadAudit = useCallback(async (p: number) => {
    try {
      const data = await request<{ rows: AuditRow[]; total: number }>(`/api/admin/audit?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`);
      setAudit(data.rows);
      setAuditTotal(data.total);
      setAuditPage(p);
    } catch { /* the audit section simply stays empty on error */ }
  }, []);

  useEffect(() => { void load(0, ''); void loadAudit(0); }, [load, loadAudit]);
  useEffect(() => {
    const t = setTimeout(() => { void load(0, search); }, 350);
    return () => clearTimeout(t);
  }, [search, load]);

  const toggleSuspend = async (row: Row) => {
    setBusyId(row.id);
    try {
      await request(`/api/admin/businesses/${row.id}`, 'PATCH', { suspended: !row.suspended });
      setToast(row.suspended ? `${row.name} is reinstated.` : `${row.name} has been suspended and taken offline.`);
      await load(page, search);
      await loadAudit(auditPage);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusyId('');
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const auditPages = Math.max(1, Math.ceil(auditTotal / PAGE_SIZE));

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
              <div className="section-heading"><div><h2>Restaurants</h2><p>Search, review, and moderate any workspace.</p></div><div className="search-input"><Search size={14} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search restaurant or owner email" /></div></div>
              {rows.length ? (
                <div className="analytics-table admin-table">
                  <div className="table-head"><span>RESTAURANT</span><span>OWNER</span><span>ITEMS · VIEWS</span><span>STATUS</span></div>
                  {rows.map(r => (
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <small>{total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total} restaurants</small>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" disabled={page <= 0} onClick={() => void load(page - 1, search)}><ChevronLeft size={14} /> Prev</button>
                  <button className="btn" disabled={page + 1 >= pages} onClick={() => void load(page + 1, search)}>Next <ChevronRight size={14} /></button>
                </span>
              </div>
            </section>

            <section className="panel" style={{ marginTop: 18 }}>
              <div className="section-heading"><div><h2>Audit log</h2><p>Team changes, publishing and moderation — the platform paper trail (Phase 6).</p></div><ScrollText size={22} /></div>
              {!audit ? <div className="loading-caption"><Loader2 size={15} className="spin" /> Loading the audit log…</div> : audit.length ? (
                <>
                  <div className="analytics-table admin-table">
                    <div className="table-head"><span>WHEN</span><span>ACTION</span><span>ACTOR</span><span>RESTAURANT</span></div>
                    {audit.map(a => (
                      <div className="table-row" key={a.id}>
                        <small>{new Date(a.createdAt).toLocaleString()}</small>
                        <div><strong style={{ fontSize: 12 }}>{a.action}</strong>{a.metadata && <small style={{ display: 'block', marginTop: 2 }}>{Object.entries(a.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</small>}</div>
                        <small>{a.actorName || a.actorEmail || '—'} · {a.actorRole}</small>
                        <small>{a.businessName || '—'}</small>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                    <small>{auditTotal === 0 ? 0 : auditPage * PAGE_SIZE + 1}–{Math.min(auditTotal, (auditPage + 1) * PAGE_SIZE)} of {auditTotal} events</small>
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" disabled={auditPage <= 0} onClick={() => void loadAudit(auditPage - 1)}><ChevronLeft size={14} /> Prev</button>
                      <button className="btn" disabled={auditPage + 1 >= auditPages} onClick={() => void loadAudit(auditPage + 1)}>Next <ChevronRight size={14} /></button>
                    </span>
                  </div>
                </>
              ) : (
                <Empty title="No audit events yet" text="Invites, role changes, removals, publish/unpublish and suspensions will appear here." />
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
