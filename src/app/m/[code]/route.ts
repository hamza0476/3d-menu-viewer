import { NextResponse } from 'next/server';
import { db } from '@/db';
import { guestEvents } from '@/db/schema';
import { uid } from '@/lib/auth';
import { resolveQr } from '@/lib/qr-data';
import { deviceClass, isQrCodeShape, qrMenuPath } from '@/lib/qr';

// QR resolver (Phase 3 — fixes G2, plan §5.4). A printed QR encodes only
// /m/<code>; the code resolves here so printouts survive menu/table changes
// and every scan is recorded before the guest lands on the menu. Unknown,
// deactivated and not-currently-public codes all get the same 404.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const notFound = () => new NextResponse('<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center"><h1>This QR code is no longer active</h1><p>Please ask a member of staff for help.</p></body></html>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (!isQrCodeShape(code)) return notFound();
  const resolved = await resolveQr(code);
  if (!resolved) return notFound();
  try {
    await db.insert(guestEvents).values({ id: uid(), businessId: resolved.business.id, qrCodeId: resolved.qr.id, tableId: resolved.table?.id ?? null, itemId: null, type: 'scan', sessionAnonId: null, deviceClass: deviceClass(req.headers.get('user-agent')) });
  } catch (e) {
    // Analytics must never block a guest from reaching the menu.
    console.error('[qr] scan event failed:', e);
  }
  return NextResponse.redirect(new URL(qrMenuPath(resolved.business.id, code), req.url), 302);
}
