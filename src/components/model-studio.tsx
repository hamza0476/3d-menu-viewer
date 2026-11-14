'use client';
import { useEffect, useState } from 'react';
import { Box, CheckCheck, Loader2, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { request } from './ui';
import { formatBytes } from '@/lib/model-quality';

// 3D Studio pipeline panel (Phase 4): every dish with a model, its
// processing state, the MEASURED quality report, and Process/Retry.
// Data comes from GET /api/models; actions POST back to it. The panel is
// honest about the processor: passthrough variants are labelled
// unoptimised, and poster/USDZ show their real configuration state.

type QualityCheck = { key: string; label: string; grade: 'good' | 'ok' | 'poor'; detail: string };
type StudioItem = {
  itemId: string; name: string; image: string; isDeal: boolean; hasModel: boolean;
  status: string; sourceBytes: number | null; highBytes: number | null; lowBytes: number | null; usdzBytes: number | null;
  triangleCount: number | null; textureCount: number | null; textureBytes: number | null;
  processor: string | null; posterStatus: string | null; usdzStatus: string | null;
  errorMessage: string | null; processedAt: string | null;
  variants: { poster: string | null; low: string | null; high: string | null; usdz: string | null };
  quality: { overall: 'good' | 'ok' | 'poor'; checks: QualityCheck[] } | null;
  lastJob: { status: string; attempts: number; error: string | null } | null;
};
type StudioData = { items: StudioItem[]; summary: { totalItems: number; withModel: number; ready: number; queuedOrProcessing: number; failed: number; percentReady: number } };

const STATUS_LABEL: Record<string, string> = {
  none: 'Not processed', queued: 'Queued', processing: 'Processing', ready: '3D ready', failed: 'Failed',
};

export default function ModelStudio() {
  const [data, setData] = useState<StudioData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>('');

  async function refresh() {
    const d = await request<StudioData>('/api/models', 'GET');
    setData(d);
    setError('');
  }
  useEffect(() => {
    let live = true;
    request<StudioData>('/api/models', 'GET').then((d) => { if (live) { setData(d); setError(''); } }).catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, []);

  // While anything is queued/processing, poll so owners watch jobs land.
  useEffect(() => {
    if (!data?.summary.queuedOrProcessing) return;
    const t = setTimeout(() => { void refresh().catch((e) => setError((e as Error).message)); }, 4000);
    return () => clearTimeout(t);
  }, [data]);

  async function act(itemId: string) {
    setBusy(itemId);
    try {
      await request('/api/models', 'POST', { itemId, action: 'process' });
      await refresh();
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  }

  if (!data) {
    return <section className="model-panel"><div className="model-panel-head"><div><h2>Model pipeline</h2><p>{error || 'Loading your 3D pipeline…'}</p></div></div></section>;
  }
  const s = data.summary;
  const modelled = data.items.filter((i) => i.hasModel);
  return (
    <section className="model-panel">
      <div className="model-panel-head">
        <div>
          <h2>Model pipeline</h2>
          <p>Uploaded GLBs are validated, measured and turned into guest-ready variants — a light model first, full detail behind it. Quality below is measured from the actual files, never estimated.</p>
        </div>
        <div className="model-summary">
          <span>{s.ready}/{s.withModel} models ready</span>
          {s.queuedOrProcessing > 0 && <span>{s.queuedOrProcessing} in pipeline</span>}
          {s.failed > 0 && <span>{s.failed} failed</span>}
          {s.withModel > 0 && <span>{s.percentReady}% of modelled dishes live in 3D</span>}
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {!modelled.length && <p className="model-note">No dishes have a 3D model yet. Add a GLB from any dish’s edit form and it will appear here for processing.</p>}
      <div className="model-rows">
        {modelled.map((item) => (
          <article key={item.itemId} className="model-row">
            {/* eslint-disable-next-line @next/next/no-img-element -- small owner thumbnail, same call as the rest of the dashboard */}
            <img className="model-thumb" src={item.variants.poster || item.image || '/images/menu-hero.jpg'} alt={item.name} loading="lazy" />
            <div className="model-row-main">
              <div className="model-row-top">
                <h3>{item.name}</h3>
                <span className={'model-chip ' + item.status}>{item.status === 'ready' ? <CheckCheck size={11} /> : item.status === 'failed' ? <TriangleAlert size={11} /> : <Box size={11} />} {STATUS_LABEL[item.status] ?? item.status}</span>
                {item.quality && <span className="model-chip">Quality: {item.quality.overall}</span>}
              </div>
              <p className="model-meta">
                Source {formatBytes(item.sourceBytes)}
                {item.status === 'ready' && <> · Low {formatBytes(item.lowBytes)} · High {formatBytes(item.highBytes)}{item.usdzBytes ? ` · USDZ ${formatBytes(item.usdzBytes)}` : ''} · {item.triangleCount?.toLocaleString('en-US')} triangles · {item.textureCount} textures ({formatBytes(item.textureBytes)})</>}
                {item.processor && <> · Processor: {item.processor === 'passthrough' ? 'passthrough (unoptimised copies)' : item.processor}</>}
                {item.posterStatus && <> · Poster: {item.posterStatus}</>}
                {item.usdzStatus && <> · USDZ: {item.usdzStatus}</>}
                {item.processedAt && <> · Processed {new Date(item.processedAt).toLocaleString()}</>}
              </p>
              {item.status === 'failed' && item.errorMessage && <p className="model-error">{item.errorMessage}</p>}
              {item.quality && (
                <div className="model-quality">
                  {item.quality.checks.map((c) => (
                    <div key={c.key} className="model-quality-row"><span className={'grade-dot grade-' + c.grade} /><b>{c.label}</b><span>{c.detail}</span></div>
                  ))}
                </div>
              )}
            </div>
            <div className="model-row-actions">
              {(item.status === 'none' || item.status === 'failed') && (
                <button className="btn" disabled={busy === item.itemId} onClick={() => void act(item.itemId)}>
                  {busy === item.itemId ? <Loader2 size={14} className="spin" /> : item.status === 'failed' ? <RotateCcw size={14} /> : <Play size={14} />}
                  {item.status === 'failed' ? 'Retry' : 'Process'}
                </button>
              )}
              {item.status === 'ready' && (
                <button className="btn" disabled={busy === item.itemId} onClick={() => void act(item.itemId)}>
                  {busy === item.itemId ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} Reprocess
                </button>
              )}
              {(item.status === 'queued' || item.status === 'processing') && <span className="model-chip processing"><Loader2 size={11} className="spin" /> In pipeline</span>}
            </div>
          </article>
        ))}
      </div>
      <p className="model-note">Processing runs in the background worker (<code>npm run models:worker</code>). If buttons seem stuck on “Queued”, the worker is not running — queued is an honest state, not a spinner. “Passthrough” means no optimiser is configured on this server yet, so variants are faithful but unoptimised copies of the source; guest phones still get the poster first and can skip the high-quality upgrade on slow connections.</p>
    </section>
  );
}
