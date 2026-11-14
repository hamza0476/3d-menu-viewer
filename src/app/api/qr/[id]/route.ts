import { NextResponse } from 'next/server';
import { db } from '@/db';
import { qrCodes } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireMembership } from '@/lib/tenancy';
import { generateQrCode } from '@/lib/qr';

async function ownQr(businessId: string, id: string) {
  const [qr] = await db.select().from(qrCodes).where(and(eq(qrCodes.id, id), eq(qrCodes.businessId, businessId)));
  return qr ?? null;
}

// Activate / deactivate a QR code without touching the printout: a
// deactivated code resolves to 404 for guests.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { id } = await params;
  const qr = await ownQr(membership.business.id, id);
  if (!qr) return NextResponse.json({ error: 'QR code not found.' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (body.active === undefined) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  const [updated] = await db.update(qrCodes).set({ active: Boolean(body.active) }).where(eq(qrCodes.id, id)).returning();
  return NextResponse.json(updated);
}

// Regenerate the code token (e.g. a printout leaked somewhere it should not
// be). The old token stops resolving immediately; the print kit must be
// re-downloaded. Historical events keep pointing at this QR row.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { id } = await params;
  const qr = await ownQr(membership.business.id, id);
  if (!qr) return NextResponse.json({ error: 'QR code not found.' }, { status: 404 });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [updated] = await db.update(qrCodes).set({ code: generateQrCode() }).where(eq(qrCodes.id, id)).returning();
      return NextResponse.json(updated);
    } catch (e) {
      if (attempt === 4 || !String((e as Error)?.message ?? e).includes('23505')) throw e;
    }
  }
  return NextResponse.json({ error: 'Could not regenerate the code.' }, { status: 500 });
}
