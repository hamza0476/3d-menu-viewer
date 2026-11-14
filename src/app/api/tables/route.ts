import { NextResponse } from 'next/server';
import { db } from '@/db';
import { tables } from '@/db/schema';
import { uid } from '@/lib/auth';
import { requireMembership } from '@/lib/tenancy';
import { createTableQr, listTablesWithQr } from '@/lib/qr-data';

// Owner table management (Phase 3 — fixes G2). The membership guard scopes
// everything to the signed-in owner's own restaurant.
export async function GET() {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const data = await listTablesWithQr(membership.business.id);
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';
  if (!label) return NextResponse.json({ error: 'Give the table a label, e.g. "Table 5".' }, { status: 400 });
  const seats = body.seats === undefined || body.seats === null || body.seats === '' ? null : Number(body.seats);
  if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 500)) return NextResponse.json({ error: 'Seats must be a whole number between 1 and 500.' }, { status: 400 });
  const [table] = await db.insert(tables).values({ id: uid(), businessId: membership.business.id, label, seats }).returning();
  const qr = await createTableQr(membership.business.id, table);
  return NextResponse.json({ ...table, qr }, { status: 201 });
}
