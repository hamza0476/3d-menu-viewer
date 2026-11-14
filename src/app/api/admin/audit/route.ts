import { NextResponse } from 'next/server';
import { db } from '@/db';
import { auditLog, businesses, users } from '@/db/schema';
import { requireAdmin } from '@/lib/admin';
import { and, count, desc, eq } from 'drizzle-orm';

// Audit log viewer feed (Phase 6). Read-only: nothing here can write to
// or delete from the trail. Filter by restaurant (?businessId=) and/or
// action (?action=), newest first, paginated like the businesses list.
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const businessId = url.searchParams.get('businessId') || '';
  const action = url.searchParams.get('action') || '';
  const conditions = [
    businessId ? eq(auditLog.businessId, businessId) : undefined,
    action ? eq(auditLog.action, action) : undefined,
  ].filter(Boolean);
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, totalRows] = await Promise.all([
    db.select({
      id: auditLog.id, action: auditLog.action, actorRole: auditLog.actorRole,
      actorEmail: users.email, actorName: users.name,
      businessId: auditLog.businessId, businessName: businesses.name,
      targetType: auditLog.targetType, targetId: auditLog.targetId,
      metadata: auditLog.metadata, ip: auditLog.ip, createdAt: auditLog.createdAt,
    })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .leftJoin(businesses, eq(businesses.id, auditLog.businessId))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(auditLog).where(where),
  ]);
  return NextResponse.json({ rows, total: Number(totalRows[0]?.total ?? 0), limit, offset });
}
