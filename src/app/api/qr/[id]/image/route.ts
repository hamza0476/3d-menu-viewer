import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createHash } from 'crypto';
import { db } from '@/db';
import { assets, qrCodes } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { uid } from '@/lib/auth';
import { requireMembership } from '@/lib/tenancy';
import { storagePut } from '@/lib/storage';
import { qrResolvePath } from '@/lib/qr';

// Server-side QR rendering (Phase 3 — fixes G2; rendering used to happen in
// the guest's browser at whatever quality the client library defaulted to).
// Error-correction level H so table stickers survive wear and a logo-safe
// centre, per the master plan §5.4. The PNG is also stored as a `qr-print`
// asset (Phase 2 storage), so print production is tracked like other media.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { id } = await params;
  const [qr] = await db.select().from(qrCodes).where(and(eq(qrCodes.id, id), eq(qrCodes.businessId, membership.business.id)));
  if (!qr) return NextResponse.json({ error: 'QR code not found.' }, { status: 404 });

  const url = new URL(req.url);
  // Build the printed target from the Host header the caller actually used:
  // Next normalises 127.0.0.1 to "localhost" in req.url, which would print
  // QRs pointing at the wrong host (the CSRF proxy learned the same lesson
  // in Phase 1). Behind a proxy, x-forwarded-host/-proto win when present.
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const target = `${proto}://${host}` + qrResolvePath(qr.code);
  const format = url.searchParams.get('format') === 'svg' ? 'svg' : 'png';
  const dark = typeof qr.design?.dark === 'string' ? qr.design.dark : '#294c3b';
  const light = typeof qr.design?.light === 'string' ? qr.design.light : '#ffffff';
  const filename = `${membership.business.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${qr.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-qr`;

  if (format === 'svg') {
    const svg = await QRCode.toString(target, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, color: { dark, light } });
    return new NextResponse(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Content-Disposition': `attachment; filename="${filename}.svg"`, 'Cache-Control': 'private, no-store' } });
  }

  const png = await QRCode.toBuffer(target, { type: 'png', errorCorrectionLevel: 'H', width: 1024, margin: 2, color: { dark, light } });

  // Record / refresh the qr-print asset for this code (one row per QR row;
  // regenerating the image overwrites the same storage key).
  const storageKey = `assets/${membership.user.id}/qr-${qr.id}.png`;
  const sha256 = createHash('sha256').update(png).digest('hex');
  await storagePut(storageKey, png);
  const [existing] = await db.select().from(assets).where(eq(assets.storageKey, storageKey));
  if (existing) {
    await db.update(assets).set({ bytes: png.length, sha256, businessId: membership.business.id }).where(eq(assets.id, existing.id));
  } else {
    await db.insert(assets).values({ id: uid(), ownerId: membership.user.id, businessId: membership.business.id, kind: 'qr-print', storageKey, mime: 'image/png', bytes: png.length, width: 1024, height: 1024, sha256, status: 'ready' });
  }

  return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${filename}.png"`, 'Cache-Control': 'private, no-store' } });
}
