'use client';
import { useEffect, useState } from 'react';
import { Box, Download, Eye, ScanLine, UtensilsCrossed } from 'lucide-react';
import { Empty, request } from './ui';

// Dashboard Analytics rebuilt on real guest events (Phase 3 — fixes G11).
// Numbers come from /api/analytics: nightly aggregates for past days plus
// today's raw events, so what an owner sees is what guests actually did —
// per day, per table and per dish. (Before Phase 3 this tab showed all-time
// counters and a recent-activity sample.) The all-time dish-views stat is
// kept: it is the products.views counter, now fed by the same event
// pipeline instead of an unprotected increment.
type Summary = {
  days: string[];
  totals: Record<string, number>;
  byDay: { day: string; counts: Record<string, number> }[];
  byTable: { id: string; label: string; counts: Record<string, number>; total: number }[];
  byItem: { id: string; name: string; counts: Record<string, number>; total: number }[];
};

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => `${(i * 96) / Math.max(values.length - 1, 1)},${40 - (v / max) * 36}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 96 44" fill="none"><polyline points={points} stroke="#6e8f72" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function StatCard({ icon: Icon, label, value, note, series }: { icon: typeof Eye; label: string; value: string; note: string; series: number[] }) {
  return (
    <div className="stat-card">
      <div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={16} /></span></div>
      <div className="stat-value-row"><strong>{value}</strong><Spark values={series} /></div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

export default function AnalyticsPanel({ period, setPeriod, totalViews, liveItems, demo }: { period: string; setPeriod: (p: string) => void; totalViews: number; liveItems: number; demo: boolean }) {
  const days = period === 'Today' ? 1 : period === 'Last 7 days' ? 7 : 30;
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    request<Summary>(`/api/analytics?days=${days}`).then((d) => { if (live) { setData(d); setError(''); } }).catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [days]);

  const series = (metric: string) => data?.byDay.map((d) => d.counts[metric] || 0) || [];
  const total = (metric: string) => data?.totals[metric] || 0;
  const maxDay = Math.max(...(data?.byDay.map((d) => Object.values(d.counts).reduce((a, b) => a + b, 0)) || [1]), 1);
  const maxItem = Math.max(...(data?.byItem.map((i) => i.total) || [1]), 1);

  return (
    <>
      <div className="analytics-toolbar">
        <span className="subtle-label">{demo ? 'Demo restaurant — real guest events for this workspace are tracked below.' : 'Real guest events: QR scans, menu opens and dish views.'}</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}><option>Last 30 days</option><option>Last 7 days</option><option>Today</option></select>
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="stats-grid">
        <StatCard icon={ScanLine} label="QR scans" value={String(total('scan'))} note={period} series={series('scan')} />
        <StatCard icon={Eye} label="Menu opens" value={String(total('menu_open'))} note={period} series={series('menu_open')} />
        <StatCard icon={Box} label="Dish views" value={String(total('item_view'))} note={period} series={series('item_view')} />
        <StatCard icon={UtensilsCrossed} label="All-time dish views" value={totalViews.toLocaleString()} note={`${liveItems} live menu items`} series={series('item_view')} />
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="section-heading"><div><h2>Day by day</h2><p>Scans, menu opens and dish views per day (UTC). Today updates live.</p></div>
          <a className="btn" href={`/api/analytics?format=csv&days=${days}`}><Download size={15} /> Export CSV</a></div>
        <div className="analytics-table">
          <div className="table-head"><span>DAY</span><span>SCANS</span><span>MENU OPENS</span><span>DISH VIEWS</span></div>
          {data?.byDay.slice().reverse().map((d) => {
            const dayTotal = Object.values(d.counts).reduce((a, b) => a + b, 0);
            return (
              <div className="table-row" key={d.day}>
                <div className="table-dish"><strong>{d.day}</strong></div>
                <strong>{d.counts.scan || 0}</strong>
                <strong>{d.counts.menu_open || 0}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><strong>{d.counts.item_view || 0}</strong><div className="bar-track" style={{ flex: 1 }}><span style={{ width: Math.max(2, (dayTotal / maxDay) * 100) + '%' }} /></div></div>
              </div>
            );
          })}
        </div>
        {data && !data.byDay.some((d) => Object.keys(d.counts).length) && <Empty title="No guest events yet" text="Share your QR codes — scans and dish views will appear here as guests explore." />}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, marginTop: 20 }}>
        <section className="panel">
          <div className="section-heading"><div><h2>By table</h2><p>Which tables bring guests to the menu</p></div></div>
          <div className="analytics-table">
            <div className="table-head"><span>TABLE</span><span>SCANS</span><span>OPENS</span><span>VIEWS</span></div>
            {data?.byTable.map((t) => (
              <div className="table-row" key={t.id}><div className="table-dish"><strong>{t.label}</strong></div><strong>{t.counts.scan || 0}</strong><strong>{t.counts.menu_open || 0}</strong><strong>{t.counts.item_view || 0}</strong></div>
            ))}
          </div>
          {data && !data.byTable.length && <Empty title="No table scans yet" text="Put a QR on a table and its scans will show up here." />}
        </section>

        <section className="panel">
          <div className="section-heading"><div><h2>Top dishes</h2><p>Ranked by dish views in this period</p></div></div>
          <div className="analytics-table">
            <div className="table-head"><span>MENU ITEM</span><span>GUEST INTEREST</span><span>VIEWS</span><span></span></div>
            {data?.byItem.map((p, i) => (
              <div className="table-row" key={p.id}>
                <div className="table-dish"><span className="rank">{i + 1}</span><span><strong>{p.name}</strong></span></div>
                <div className="bar-track"><span style={{ width: Math.max(3, (p.total / maxItem) * 100) + '%' }} /></div>
                <strong>{p.total}</strong><span></span>
              </div>
            ))}
          </div>
          {data && !data.byItem.length && <Empty title="No dish views yet" text="When a guest taps a dish, it will be counted here." />}
        </section>
      </div>
    </>
  );
}
