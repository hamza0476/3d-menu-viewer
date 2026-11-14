import { NextResponse } from 'next/server';
import { db } from '@/db';
import { businesses } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin';
import { activity } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const [business] = await db.select().from(businesses).where(eq(businesses.id, id));
  if (!business) return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 });
  const suspended = Boolean(body.suspended);
  const values: { suspended: boolean; published?: boolean } = { suspended };
  if (suspended) values.published = false; // take the menu offline for guests immediately
  const [updated] = await db.update(businesses).set(values).where(eq(businesses.id, id)).returning();
  await activity(id, suspended ? 'This restaurant was suspended by Platera and taken offline.' : 'This restaurant was reinstated by Platera.', 'business');
  if (suspended !== business.suspended) await audit({ actorUserId: admin.id, actorRole: 'admin', businessId: id, action: suspended ? 'admin.suspend' : 'admin.reinstate', targetType: 'business', targetId: id });
  return NextResponse.json(updated);
}
