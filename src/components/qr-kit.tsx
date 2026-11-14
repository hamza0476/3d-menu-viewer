'use client';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, Plus, Power, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { request } from './ui';

// Tables & print kit (Phase 3 — fixes G2). The master QR and one QR per
// table are managed server-side: codes resolve through /m/<code>, can be
// deactivated or regenerated without reprinting anything else, and the
// downloadable PNG / print layouts are rendered by the server at print
// quality. The small thumbnails here are browser-rendered previews only.
type Qr = { id: string; code: string; label: string; tableId: string | null; active: boolean };
type TableRow = { id: string; label: string; seats: number | null; active: boolean; qr: Qr | null };
type KitData = { master: Qr; tables: TableRow[] };

function QrActions({ qr, onChanged }: { qr: Qr; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/m/${qr.code}` : `/m/${qr.code}`;
  async function act(fn: () => Promise<unknown>) { try { await fn(); onChanged(); } catch { /* the list reload shows the true state */ } }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <a className="btn" href={`/api/qr/${qr.id}/image`}><Download size={14} /> PNG</a>
      <a className="btn" href={`/print/qr/${qr.id}?layout=tent`} target="_blank" rel="noreferrer"><Printer size={14} /> Tent</a>
      <a className="btn" href={`/print/qr/${qr.id}?layout=sticker`} target="_blank" rel="noreferrer">Sticker</a>
      <a className="btn" href={`/print/qr/${qr.id}?layout=standee`} target="_blank" rel="noreferrer">Standee</a>
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Copy the link', link); } }}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}</button>
      <button className="btn" title="Print a fresh code — the old printout stops working" onClick={() => { if (window.confirm('Regenerate this code? Existing printouts of it will stop working.')) void act(() => request(`/api/qr/${qr.id}`, 'POST')); }}><RefreshCw size={14} /> Regenerate</button>
      <button className="btn" onClick={() => void act(() => request(`/api/qr/${qr.id}`, 'PATCH', { active: !qr.active }))}><Power size={14} /> {qr.active ? 'Deactivate' : 'Activate'}</button>
    </div>
  );
}

function QrThumb({ code }: { code: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(`${window.location.origin}/m/${code}`, { width: 240, margin: 1, errorCorrectionLevel: 'H', color: { dark: '#294c3b', light: '#ffffff' } }).then((d) => { if (live) setSrc(d); }).catch(() => {});
    return () => { live = false; };
  }, [code]);
  // The thumbnail is a runtime-generated data URL — next/image cannot
  // optimise those, so the plain <img> is deliberate here.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="QR code preview" style={{ width: 76, height: 76, borderRadius: 8, border: '1px solid #e2e7da' }} /> : <div className="skeleton" style={{ width: 76, height: 76, borderRadius: 8 }} />;
}

export default function QrKit() {
  const [data, setData] = useState<KitData | null>(null);
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const load = useCallback(() => setRefreshTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    request<KitData>('/api/tables')
      .then((d) => { if (live) { setData(d); setError(''); } })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [refreshTick]);

  async function addTable() {
    setBusy(true); setError('');
    try {
      await request('/api/tables', 'POST', { label, seats: seats === '' ? undefined : Number(seats) });
      setLabel(''); setSeats('');
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function removeTable(t: TableRow) {
    if (!window.confirm(`Delete ${t.label}? Its printed QR code will stop working. Past analytics stay.`)) return;
    try { await request(`/api/tables/${t.id}`, 'DELETE'); load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="section-heading">
        <div><h2>Tables &amp; print kit</h2><p>One QR for the counter, one per table. Scans are attributed to the table, and a code can be re-pointed or switched off without reprinting the rest.</p></div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {!data ? <p style={{ color: '#8a9b76', fontSize: 13 }}>Loading your codes…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <QrThumb code={data.master.code} />
            <div style={{ flex: '1 1 220px' }}>
              <strong>Master QR</strong> <span className={'status-pill'}><i />{data.master.active ? 'Active' : 'Off'}</span>
              <p style={{ fontSize: 12, color: '#8a9b76', margin: '4px 0 8px' }}>For the counter, takeaway bags and your socials — no table attached.</p>
              <QrActions qr={data.master} onChanged={load} />
            </div>
          </div>

          {data.tables.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #edf0e7', paddingTop: 14 }}>
              {t.qr ? <QrThumb code={t.qr.code} /> : <div className="skeleton" style={{ width: 76, height: 76, borderRadius: 8 }} />}
              <div style={{ flex: '1 1 220px' }}>
                <strong>{t.label}</strong>{t.seats ? <span style={{ color: '#8a9b76', fontSize: 12 }}> · seats {t.seats}</span> : null} {t.qr && <span className="status-pill"><i />{t.qr.active ? 'Active' : 'Off'}</span>}
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {t.qr && <QrActions qr={t.qr} onChanged={load} />}
                  <button className="btn" onClick={() => void removeTable(t)}><Trash2 size={14} /> Delete table</button>
                </div>
              </div>
            </div>
          ))}
          {!data.tables.length && <p style={{ fontSize: 13, color: '#8a9b76' }}>No tables yet — add your first table and its QR is created instantly.</p>}

          <div className="form-row" style={{ borderTop: '1px solid #edf0e7', paddingTop: 14 }}>
            <label>New table label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Table 1" maxLength={60} /></label>
            <label>Seats (optional)<input value={seats} onChange={(e) => setSeats(e.target.value.replace(/[^0-9]/g, ''))} placeholder="4" inputMode="numeric" /></label>
            <button className="btn primary" disabled={busy || !label.trim()} onClick={() => void addTable()}><Plus size={15} /> Add table &amp; QR</button>
          </div>
        </div>
      )}
    </section>
  );
}
