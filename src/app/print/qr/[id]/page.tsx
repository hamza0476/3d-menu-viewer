import { notFound } from 'next/navigation';
import { db } from '@/db';
import { qrCodes } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getUser, ownerBusiness } from '@/lib/auth';

// Print kit (Phase 3 — fixes G2): server-rendered printable cards for a QR
// code — table tent, sticker, counter standee. Owners print this page (or
// "Save as PDF" in the browser print dialog) for production. The QR image
// itself is rendered server-side at print quality by /api/qr/[id]/image.
const LAYOUTS = {
  tent: { name: 'Table tent (A6)', width: '105mm', height: '148mm' },
  sticker: { name: 'Sticker (100 × 100 mm)', width: '100mm', height: '100mm' },
  standee: { name: 'Counter standee (A5)', width: '148mm', height: '210mm' },
} as const;
type Layout = keyof typeof LAYOUTS;

export default async function QrPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ layout?: string }> }) {
  const user = await getUser();
  if (!user) notFound();
  const business = await ownerBusiness();
  if (!business) notFound();
  const { id } = await params;
  const { layout: rawLayout } = await searchParams;
  const layout: Layout = rawLayout === 'sticker' || rawLayout === 'standee' ? rawLayout : 'tent';
  const [qr] = await db.select().from(qrCodes).where(and(eq(qrCodes.id, id), eq(qrCodes.businessId, business.id)));
  if (!qr) notFound();
  const spec = LAYOUTS[layout];
  const img = `/api/qr/${qr.id}/image?format=png`;
  const isMaster = !qr.tableId;

  return (
    <main style={{ minHeight: '100vh', background: '#e9ede4', padding: '32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <style>{`
        @media print {
          body { background: #fff !important; }
          .print-toolbar { display: none !important; }
          .print-main { padding: 0 !important; background: #fff !important; }
          .print-card { box-shadow: none !important; margin: 0 auto !important; }
          @page { margin: 8mm; }
        }
      `}</style>
      <div className="print-toolbar" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <strong>{spec.name}</strong>
        <span style={{ color: '#5c6b58', fontSize: 13 }}>{business.name} · {qr.label}</span>
        {(Object.keys(LAYOUTS) as Layout[]).map((l) => (
          <a key={l} className="btn" href={`/print/qr/${qr.id}?layout=${l}`}>{LAYOUTS[l].name}</a>
        ))}
        <span style={{ fontSize: 13, color: '#5c6b58' }}>Use your browser&apos;s Print → “Save as PDF” for a PDF file.</span>
      </div>

      <div className="print-card" style={{ width: spec.width, minHeight: spec.height, background: '#fff', borderRadius: layout === 'sticker' ? '50%' : 12, boxShadow: '0 10px 40px rgba(30,50,35,.18)', padding: layout === 'sticker' ? '10mm' : '8mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '4mm', overflow: 'hidden' }}>
        {layout === 'tent' && <div style={{ borderBottom: '1px dashed #b9c4ae', width: '100%', paddingBottom: '3mm', fontSize: 10, letterSpacing: 2, color: '#8a9b76' }}>FOLD HERE · PLACE ON THE TABLE</div>}
        <div style={{ fontSize: 12, letterSpacing: 3, color: '#6e8f72', fontWeight: 700 }}>PLATERA</div>
        <h1 style={{ fontSize: layout === 'standee' ? 30 : 20, margin: 0, color: '#294c3b' }}>{business.name}</h1>
        <p style={{ margin: 0, color: '#5c6b58', fontSize: layout === 'standee' ? 14 : 12 }}>{business.tagline}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={`QR code for ${qr.label}`} style={{ width: layout === 'sticker' ? '62mm' : layout === 'standee' ? '85mm' : '68mm', height: 'auto' }} />
        <strong style={{ fontSize: layout === 'standee' ? 18 : 14, color: '#294c3b' }}>Scan to explore our menu in 3D</strong>
        <span style={{ fontSize: 12, color: '#5c6b58' }}>{isMaster ? 'Point your camera at the code — no app needed.' : `You're at ${qr.label} — the menu knows your table.`}</span>
        {layout === 'standee' && (
          <ol style={{ textAlign: 'left', fontSize: 13, color: '#41523d', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
            <li>Open your phone camera</li>
            <li>Point it at the QR code</li>
            <li>Tap the link and explore the menu</li>
          </ol>
        )}
      </div>
    </main>
  );
}
