import { NextResponse } from 'next/server';
import { db } from '@/db';
import { businesses, users, products } from '@/db/schema';
import { requireAdmin } from '@/lib/admin';
import { count, desc, eq, ilike, or, sql } from 'drizzle-orm';

// Platform overview (Phase 6 rework — finding S8): aggregates and
// pagination now happen in SQL. The previous version loaded every
// business, user and product into memory and joined them in JS; fine
// for a pilot, wrong shape as the platform grows. Response fields are
// unchanged, plus total/limit/offset for the pager. ?q= searches the
// restaurant name and the owner email server-side.
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const q = (url.searchParams.get('q') || '').trim();
  const where = q ? or(ilike(businesses.name, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined;

  const viewsSum = sql<number>`coalesce(sum(${products.views}), 0)`;
  const [rowsRaw, totalRows, bizStats, prodStats, unverified] = await Promise.all([
    db.select({
      id: businesses.id, name: businesses.name, city: businesses.city, province: businesses.province,
      currency: businesses.currency, published: businesses.published, suspended: businesses.suspended,
      ownerName: users.name, ownerEmail: users.email, ownerVerified: users.emailVerified, ownerDemo: users.demo,
      productCount: count(products.id), views: viewsSum,
    })
      .from(businesses)
      .innerJoin(users, eq(users.id, businesses.ownerId))
      .leftJoin(products, eq(products.businessId, businesses.id))
      .where(where)
      .groupBy(businesses.id, users.id)
      .orderBy(desc(viewsSum))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(businesses).innerJoin(users, eq(users.id, businesses.ownerId)).where(where),
    db.select({
      restaurants: count(),
      liveMenus: sql<number>`count(*) filter (where ${businesses.published} and not ${businesses.suspended})`,
      suspended: sql<number>`count(*) filter (where ${businesses.suspended})`,
    }).from(businesses),
    db.select({ items: count(), views: viewsSum }).from(products),
    db.select({ n: count() }).from(users).where(sql`${users.demo} = false and ${users.emailVerified} = false`),
  ]);

  const rows = rowsRaw.map(r => ({ ...r, productCount: Number(r.productCount), views: Number(r.views) }));
  const stats = {
    restaurants: Number(bizStats[0]?.restaurants ?? 0),
    liveMenus: Number(bizStats[0]?.liveMenus ?? 0),
    suspended: Number(bizStats[0]?.suspended ?? 0),
    items: Number(prodStats[0]?.items ?? 0),
    views: Number(prodStats[0]?.views ?? 0),
    unverifiedOwners: Number(unverified[0]?.n ?? 0),
  };
  return NextResponse.json({ rows, stats, total: Number(totalRows[0]?.total ?? 0), limit, offset });
}
