import { NextResponse } from 'next/server';
import { db } from '@/db';
import { businesses, products } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { ownerBusiness, activity } from '@/lib/auth';
import { DEALS_CATEGORY } from '@/lib/demo';

const MAX_CATEGORIES = 24;
const clean = (v: unknown) => String(v || '').trim().slice(0, 40);

export async function POST(req: Request) {
  const business = await ownerBusiness();
  if (!business) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { name } = await req.json();
  const value = clean(name);
  if (!value) return NextResponse.json({ error: 'Enter a category name.' }, { status: 400 });
  if (value.toLowerCase() === DEALS_CATEGORY.toLowerCase()) return NextResponse.json({ error: '"Deals" is a built-in section — mark items as a deal instead of adding this category.' }, { status: 400 });
  const current = business.categories;
  if (current.some(c => c.toLowerCase() === value.toLowerCase())) return NextResponse.json({ error: 'That category already exists.' }, { status: 409 });
  if (current.length >= MAX_CATEGORIES) return NextResponse.json({ error: `You can have up to ${MAX_CATEGORIES} categories.` }, { status: 400 });
  const categories = [...current, value];
  const [updated] = await db.update(businesses).set({ categories }).where(eq(businesses.id, business.id)).returning();
  await activity(business.id, `Added the "${value}" category`, 'business');
  return NextResponse.json(updated);
}

export async function PATCH(req: Request) {
  const business = await ownerBusiness();
  if (!business) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const body = await req.json();
  const current = business.categories;

  if (Array.isArray(body.order)) {
    const order: string[] = body.order.map(clean).filter(Boolean);
    if (order.length !== current.length || !order.every((o: string) => current.includes(o))) return NextResponse.json({ error: 'That order does not match your current categories.' }, { status: 400 });
    const [updated] = await db.update(businesses).set({ categories: order }).where(eq(businesses.id, business.id)).returning();
    return NextResponse.json(updated);
  }

  const oldName = clean(body.oldName);
  const newName = clean(body.newName);
  if (!oldName || !newName) return NextResponse.json({ error: 'Enter a category name.' }, { status: 400 });
  if (!current.includes(oldName)) return NextResponse.json({ error: 'That category no longer exists.' }, { status: 404 });
  if (newName.toLowerCase() === DEALS_CATEGORY.toLowerCase()) return NextResponse.json({ error: '"Deals" is a reserved section name.' }, { status: 400 });
  if (oldName !== newName && current.some(c => c.toLowerCase() === newName.toLowerCase())) return NextResponse.json({ error: 'That category already exists.' }, { status: 409 });
  const categories = current.map(c => c === oldName ? newName : c);
  const [updated] = await db.update(businesses).set({ categories }).where(eq(businesses.id, business.id)).returning();
  if (oldName !== newName) {
    await db.update(products).set({ category: newName }).where(and(eq(products.businessId, business.id), eq(products.category, oldName)));
    await activity(business.id, `Renamed "${oldName}" to "${newName}"`, 'business');
  }
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const business = await ownerBusiness();
  if (!business) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { name } = await req.json();
  const value = clean(name);
  const current = business.categories;
  if (!current.includes(value)) return NextResponse.json({ error: 'That category no longer exists.' }, { status: 404 });
  const categories = current.filter(c => c !== value);
  const fallback = categories[0] || 'Uncategorized';
  if (!categories.length) categories.push(fallback);
  const [updated] = await db.update(businesses).set({ categories }).where(eq(businesses.id, business.id)).returning();
  const moved = await db.update(products).set({ category: fallback }).where(and(eq(products.businessId, business.id), eq(products.category, value))).returning();
  await activity(business.id, moved.length ? `Removed "${value}" — ${moved.length} item(s) moved to "${fallback}"` : `Removed the "${value}" category`, 'business');
  return NextResponse.json(updated);
}
