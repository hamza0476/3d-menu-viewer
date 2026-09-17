import { NextResponse } from 'next/server';
import { db } from '@/db';
import { businesses } from '@/db/schema';
import { and, eq, asc } from 'drizzle-orm';

export async function GET() {
  const [first] = await db.select({ id: businesses.id }).from(businesses).where(and(eq(businesses.published, true), eq(businesses.suspended, false))).orderBy(asc(businesses.id)).limit(1);
  if (!first) return NextResponse.json({ error: 'No menus available.' }, { status: 404 });
  return NextResponse.json({ id: first.id });
}
