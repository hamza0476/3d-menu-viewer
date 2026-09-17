import { NextResponse } from 'next/server';
import { db } from '@/db';
import { businesses, users, products } from '@/db/schema';
import { requireAdmin } from '@/lib/admin';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });

  const [allBusinesses, allUsers, allProducts] = await Promise.all([
    db.select().from(businesses),
    db.select().from(users),
    db.select().from(products),
  ]);
  const userById = new Map(allUsers.map(u => [u.id, u]));

  const rows = allBusinesses
    .map(b => {
      const owner = userById.get(b.ownerId);
      const items = allProducts.filter(p => p.businessId === b.id);
      return {
        id: b.id,
        name: b.name,
        city: b.city,
        province: b.province,
        currency: b.currency,
        published: b.published,
        suspended: b.suspended,
        ownerName: owner?.name || '—',
        ownerEmail: owner?.email || '—',
        ownerVerified: owner?.emailVerified ?? false,
        ownerDemo: owner?.demo ?? false,
        productCount: items.length,
        views: items.reduce((sum, p) => sum + p.views, 0),
      };
    })
    .sort((a, b) => b.views - a.views);

  const stats = {
    restaurants: allBusinesses.length,
    liveMenus: allBusinesses.filter(b => b.published && !b.suspended).length,
    suspended: allBusinesses.filter(b => b.suspended).length,
    items: allProducts.length,
    views: allProducts.reduce((sum, p) => sum + p.views, 0),
    unverifiedOwners: allUsers.filter(u => !u.demo && !u.emailVerified).length,
  };

  return NextResponse.json({ rows, stats });
}
