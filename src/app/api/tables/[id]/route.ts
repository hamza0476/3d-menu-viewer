import { NextResponse } from 'next/server';
import { db } from '@/db';
import { qrCodes, tables } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireMembership } from '@/lib/tenancy';

// Scoped to the owner's own restaurant: a table id from another restaurant
// is indistinguishable from a missing one (404 either way).
async function ownTable(businessId: string, id: string) {
  const [table] = await db.select().from(tables).where(and(eq(tables.id, id), eq(tables.businessId, businessId)));
  return table ?? null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { id } = await params;
  const table = await ownTable(membership.business.id, id);
  if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const values: Partial<typeof tables.$inferInsert> = {};
  if (body.label !== undefined) {
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';
    if (!label) return NextResponse.json({ error: 'Give the table a label, e.g. "Table 5".' }, { status: 400 });
    values.label = label;
  }
  if (body.seats !== undefined) {
    const seats = body.seats === null || body.seats === '' ? null : Number(body.seats);
    if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 500)) return NextResponse.json({ error: 'Seats must be a whole number between 1 and 500.' }, { status: 400 });
    values.seats = seats;
  }
  if (body.active !== undefined) values.active = Boolean(body.active);
  const [updated] = await db.update(tables).set(values).where(eq(tables.id, id)).returning();
  // Keep the QR's printed label in step with the table's name.
  if (values.label) await db.update(qrCodes).set({ label: values.label }).where(eq(qrCodes.tableId, id));
  const [qr] = await db.select().from(qrCodes).where(eq(qrCodes.tableId, id));
  return NextResponse.json({ ...updated, qr: qr ?? null });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { id } = await params;
  const table = await ownTable(membership.business.id, id);
  if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 });
  // The table's QR code row cascades away with it; historical guest events
  // keep their aggregates but their table/qr references null out (FK rules).
  await db.delete(tables).where(eq(tables.id, id));
  return NextResponse.json({ ok: true });
}
