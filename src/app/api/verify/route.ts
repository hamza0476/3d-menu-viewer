import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { consumeToken } from '@/lib/auth';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const origin = new URL(req.url).origin;
  const row = await consumeToken(token, 'verify');
  if (!row) return NextResponse.redirect(`${origin}/?verified=0`);
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, row.userId));
  return NextResponse.redirect(`${origin}/?verified=1`);
}
