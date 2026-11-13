import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { consumeToken } from '@/lib/auth';

// Email verification is a two-step, prefetch-safe flow (S9):
// the emailed link lands here with GET, which must NOT consume the token —
// mail scanners and link previewers fetch links automatically, and a
// consumed-on-GET token would be burned before the owner ever clicks.
// GET only forwards to a confirmation page; the token is consumed by the
// explicit POST from that page's button.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  return NextResponse.redirect(`${url.origin}/verify-email?token=${encodeURIComponent(token)}`);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String((body as { token?: unknown }).token || '');
  if (!token) return NextResponse.json({ error: 'This verification link is missing its token.' }, { status: 400 });
  const row = await consumeToken(token, 'verify');
  if (!row) return NextResponse.json({ error: 'This verification link is invalid or has expired. Sign in and request a new one.' }, { status: 400 });
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, row.userId));
  return NextResponse.json({ ok: true });
}
