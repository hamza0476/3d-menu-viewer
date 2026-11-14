import { NextResponse } from 'next/server';
import { db } from '@/db';
import { businesses, guestEvents, products } from '@/db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { activity, uid } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { resolveQr } from '@/lib/qr-data';
import { attachModelBundles } from '@/lib/model-data';
import { getBusinessBranding } from '@/lib/branding';
import { sha256Hex } from '@/lib/media-validation';
import { deviceClass, hashSessionAnonId, isQrCodeShape, shouldCountEvent } from '@/lib/qr';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const [business] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.published, true), eq(businesses.suspended, false))); if (!business) return NextResponse.json({ error: 'This menu is not currently published.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } }); const items = await db.select().from(products).where(and(eq(products.businessId, id), eq(products.available, true)));
  // Phase 4: attach the processed-model bundle (poster -> low -> high,
  // USDZ for iOS AR) for items whose pipeline run is ready — shared with
  // the guest menu page via lib/model-data.ts.
  const enriched = await attachModelBundles(items);
  const branding = await getBusinessBranding(id);
  const payload = { business: { id: business.id, name: business.name, tagline: business.tagline, city: business.city, address: business.address, province: business.province, phone: business.phone, currency: business.currency, categories: business.categories, categoriesUr: business.categoriesUr }, branding, products: enriched };
  // Phase 5: the public menu payload is CDN/SW-cacheable — it changes
  // only when the owner edits the menu. A content ETag (sha256 of the
  // exact JSON) + stale-while-revalidate lets edges and the service
  // worker serve repeat opens instantly and revalidate in the
  // background; a matching If-None-Match answers 304 with no body.
  const body = JSON.stringify(payload);
  const etag = '"' + sha256Hex(Buffer.from(body)) + '"';
  const cacheHeaders = { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300', ETag: etag };
  if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers: cacheHeaders });
  return new NextResponse(body, { headers: { ...cacheHeaders, 'Content-Type': 'application/json' } }); }

// Guest event pipeline (Phase 3 — fixes G11, S12). This endpoint is public
// by necessity (guests are anonymous), so abuse control is layered:
//   1. per-connection rate limits via the Phase 1 limiter (429 past them);
//   2. per-session de-duplication — the same anonymous session re-opening
//      the same dish (or the menu) inside 60 s counts once, so neither an
//      idly tapping guest nor a replayed session inflates counters;
//   3. counters (products.views) and the activity feed advance only for
//      events that pass both layers.
// Attribution: a valid `qrCode` in the body ties the event to that table;
// an unknown/foreign code is ignored, never an error.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.published, true), eq(businesses.suspended, false)));
  if (!business) return NextResponse.json({ error: 'Menu unavailable' }, { status: 404 });

  const ip = clientIp(req);
  let qrCodeId: string | null = null;
  let tableId: string | null = null;
  if (isQrCodeShape(body.qrCode)) {
    const resolved = await resolveQr(body.qrCode);
    if (resolved && resolved.business.id === id) { qrCodeId = resolved.qr.id; tableId = resolved.table?.id ?? null; }
  }
  const sessionAnonId = typeof body.sessionId === 'string' && body.sessionId.length >= 8 ? hashSessionAnonId(body.sessionId.slice(0, 128)) : null;
  const device = deviceClass(req.headers.get('user-agent'));
  const now = Date.now();

  async function deduped(type: string, itemId: string | null): Promise<boolean> {
    if (!sessionAnonId) return false;
    const [last] = await db.select({ createdAt: guestEvents.createdAt }).from(guestEvents)
      .where(and(eq(guestEvents.businessId, id), eq(guestEvents.sessionAnonId, sessionAnonId), eq(guestEvents.type, type), itemId ? eq(guestEvents.itemId, itemId) : isNull(guestEvents.itemId)))
      .orderBy(desc(guestEvents.createdAt)).limit(1);
    return Boolean(last) && !shouldCountEvent(last.createdAt.getTime(), now);
  }

  const productId = typeof body.productId === 'string' ? body.productId : null;
  if (productId && body.type === '3d_open') {
    // Phase 4: a guest actually opened the 3D viewer for a dish. Same
    // rate-limit + dedupe layers as item views, counted separately in
    // analytics (the Phase 3 rollup already folds any event type), and it
    // does not inflate the item's view counter.
    if (!(await rateLimit(`events:item:${id}:${ip}`, 120, 60000)).allowed) return NextResponse.json({ error: 'Too many events. Please slow down.' }, { status: 429 });
    if (await deduped('3d_open', productId)) return NextResponse.json({ ok: true, deduped: true });
    const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.businessId, id), eq(products.available, true)));
    if (!p) return NextResponse.json({ ok: true });
    await db.insert(guestEvents).values({ id: uid(), businessId: id, qrCodeId, tableId, itemId: p.id, type: '3d_open', sessionAnonId, deviceClass: device });
    return NextResponse.json({ ok: true });
  }
  if (productId) {
    if (!(await rateLimit(`events:item:${id}:${ip}`, 120, 60000)).allowed) return NextResponse.json({ error: 'Too many events. Please slow down.' }, { status: 429 });
    if (await deduped('item_view', productId)) return NextResponse.json({ ok: true, deduped: true });
    const [p] = await db.update(products).set({ views: sql`${products.views} + 1` }).where(and(eq(products.id, productId), eq(products.businessId, id), eq(products.available, true))).returning();
    if (!p) return NextResponse.json({ ok: true });
    await db.insert(guestEvents).values({ id: uid(), businessId: id, qrCodeId, tableId, itemId: p.id, type: 'item_view', sessionAnonId, deviceClass: device });
    await activity(id, `A guest explored ${p.name} in 3D`, 'view');
    return NextResponse.json({ ok: true });
  }

  if (!(await rateLimit(`events:open:${id}:${ip}`, 30, 60000)).allowed) return NextResponse.json({ error: 'Too many events. Please slow down.' }, { status: 429 });
  if (await deduped('menu_open', null)) return NextResponse.json({ ok: true, deduped: true });
  await db.insert(guestEvents).values({ id: uid(), businessId: id, qrCodeId, tableId, itemId: null, type: 'menu_open', sessionAnonId, deviceClass: device });
  await activity(id, 'A guest opened your digital menu', 'scan');
  return NextResponse.json({ ok: true });
}
