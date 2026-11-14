import { NextResponse } from 'next/server';
import { db } from '@/db';
import { businesses, products } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { activity } from '@/lib/auth';
import { requireMembership, roleAllowed } from '@/lib/tenancy';
import { DEALS_CATEGORY } from '@/lib/demo';

const MAX_CATEGORIES = 24;
const clean = (v: unknown) => String(v || '').trim().slice(0, 40);
// Phase 6: categories_ur[i] is the Urdu name for categories[i] (or null).
// Every mutation rebuilds the Urdu array in lockstep with the English one
// so the two can never drift out of alignment.
const cleanUr = (v: unknown) => { const s = String(v || '').trim().slice(0, 60); return s || null; };
const alignedUr = (business: { categories: string[]; categoriesUr: (string | null)[] | null }) => business.categories.map((_, i) => cleanUr(business.categoriesUr?.[i]));

export async function POST(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const business = membership.business;
  if (!roleAllowed(membership.role, 'manager')) return NextResponse.json({ error: 'Your role does not allow this. Ask the owner or a manager.' }, { status: 403 });
  const body = await req.json();
  const value = clean(body.name);
  if (!value) return NextResponse.json({ error: 'Enter a category name.' }, { status: 400 });
  if (value.toLowerCase() === DEALS_CATEGORY.toLowerCase()) return NextResponse.json({ error: '"Deals" is a built-in section — mark items as a deal instead of adding this category.' }, { status: 400 });
  const current = business.categories;
  if (current.some(c => c.toLowerCase() === value.toLowerCase())) return NextResponse.json({ error: 'That category already exists.' }, { status: 409 });
  if (current.length >= MAX_CATEGORIES) return NextResponse.json({ error: `You can have up to ${MAX_CATEGORIES} categories.` }, { status: 400 });
  const categories = [...current, value];
  const categoriesUr = [...alignedUr(business), cleanUr(body.nameUr)];
  const [updated] = await db.update(businesses).set({ categories, categoriesUr }).where(eq(businesses.id, business.id)).returning();
  await activity(business.id, `Added the "${value}" category`, 'business');
  return NextResponse.json(updated);
}

export async function PATCH(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const business = membership.business;
  if (!roleAllowed(membership.role, 'manager')) return NextResponse.json({ error: 'Your role does not allow this. Ask the owner or a manager.' }, { status: 403 });
  const body = await req.json();
  const current = business.categories;

  if (Array.isArray(body.order)) {
    const order: string[] = body.order.map(clean).filter(Boolean);
    if (order.length !== current.length || !order.every((o: string) => current.includes(o))) return NextResponse.json({ error: 'That order does not match your current categories.' }, { status: 400 });
    const ur = alignedUr(business);
    const categoriesUr = order.map(name => ur[current.indexOf(name)] ?? null);
    const [updated] = await db.update(businesses).set({ categories: order, categoriesUr }).where(eq(businesses.id, business.id)).returning();
    return NextResponse.json(updated);
  }

  const oldName = clean(body.oldName);
  const newName = clean(body.newName);
  if (!oldName || !newName) return NextResponse.json({ error: 'Enter a category name.' }, { status: 400 });
  if (!current.includes(oldName)) return NextResponse.json({ error: 'That category no longer exists.' }, { status: 404 });
  if (newName.toLowerCase() === DEALS_CATEGORY.toLowerCase()) return NextResponse.json({ error: '"Deals" is a reserved section name.' }, { status: 400 });
  if (oldName !== newName && current.some(c => c.toLowerCase() === newName.toLowerCase())) return NextResponse.json({ error: 'That category already exists.' }, { status: 409 });
  const categories = current.map(c => c === oldName ? newName : c);
  const categoriesUr = alignedUr(business);
  if (body.newNameUr !== undefined) { const idx = current.indexOf(oldName); if (idx >= 0) categoriesUr[idx] = cleanUr(body.newNameUr); }
  const [updated] = await db.update(businesses).set({ categories, categoriesUr }).where(eq(businesses.id, business.id)).returning();
  if (oldName !== newName) {
    await db.update(products).set({ category: newName }).where(and(eq(products.businessId, business.id), eq(products.category, oldName)));
    await activity(business.id, `Renamed "${oldName}" to "${newName}"`, 'business');
  }
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const business = membership.business;
  if (!roleAllowed(membership.role, 'manager')) return NextResponse.json({ error: 'Your role does not allow this. Ask the owner or a manager.' }, { status: 403 });
  const { name } = await req.json();
  const value = clean(name);
  const current = business.categories;
  if (!current.includes(value)) return NextResponse.json({ error: 'That category no longer exists.' }, { status: 404 });
  const removeIdx = current.indexOf(value);
  const categories = current.filter(c => c !== value);
  const categoriesUr = alignedUr(business).filter((_, i) => i !== removeIdx);
  const fallback = categories[0] || 'Uncategorized';
  if (!categories.length) { categories.push(fallback); categoriesUr.push(null); }
  const [updated] = await db.update(businesses).set({ categories, categoriesUr }).where(eq(businesses.id, business.id)).returning();
  const moved = await db.update(products).set({ category: fallback }).where(and(eq(products.businessId, business.id), eq(products.category, value))).returning();
  await activity(business.id, moved.length ? `Removed "${value}" — ${moved.length} item(s) moved to "${fallback}"` : `Removed the "${value}" category`, 'business');
  return NextResponse.json(updated);
}
