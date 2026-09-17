import { NextResponse } from 'next/server';
import { db } from '@/db';
import { products } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { ownerBusiness, uid, activity } from '@/lib/auth';
import { DISH_TAG_IDS, DEALS_CATEGORY } from '@/lib/demo';

function values(b: Record<string, unknown>) {
  if (typeof b.name !== 'string' || !b.name.trim() || !Number.isInteger(b.price) || Number(b.price) < 0 || Number(b.price) > 1000000) throw new Error('Enter a name and a valid price.');
  const safeUrl = (v: unknown) => typeof v === 'string' && (v.startsWith('https://') || v.startsWith('/api/assets/')) ? v : '';
  const isDeal = Boolean(b.isDeal);
  let originalPrice: number | null = null;
  if (b.originalPrice !== undefined && b.originalPrice !== null && b.originalPrice !== '') {
    if (!Number.isInteger(b.originalPrice) || Number(b.originalPrice) < 0 || Number(b.originalPrice) > 1000000) throw new Error('Enter a valid original price.');
    if (Number(b.originalPrice) <= Number(b.price)) throw new Error('The original price should be higher than the current price, so guests can see the discount.');
    originalPrice = Number(b.originalPrice);
  }
  const dealItems = Array.isArray(b.dealItems) ? Array.from(new Set(b.dealItems.filter((d): d is string => typeof d === 'string'))) : [];
  if (isDeal && dealItems.length < 2) throw new Error('Select at least 2 items to bundle into this deal.');
  return {
    name: b.name.trim().slice(0, 120),
    description: String(b.description || '').slice(0, 2000),
    price: Number(b.price),
    originalPrice,
    category: isDeal ? DEALS_CATEGORY : String(b.category || 'Main courses').slice(0, 60),
    image: safeUrl(b.image),
    model: safeUrl(b.model) || null,
    photos: Array.isArray(b.photos) ? b.photos.filter(p => safeUrl(p)).slice(0, 16) as string[] : [],
    tags: Array.isArray(b.tags) ? Array.from(new Set(b.tags.filter((t): t is string => typeof t === 'string' && (DISH_TAG_IDS as string[]).includes(t)))) : [],
    isDeal,
    dealItems: isDeal ? dealItems.slice(0, 12) : [],
    available: b.available !== false,
  };
}

async function assertValidDeal(businessId: string, selfId: string | undefined, data: ReturnType<typeof values>) {
  if (!data.isDeal || !data.dealItems.length) return;
  if (selfId && data.dealItems.includes(selfId)) throw new Error('A deal cannot include itself.');
  const rows = await db.select({ id: products.id, isDeal: products.isDeal }).from(products).where(and(eq(products.businessId, businessId), inArray(products.id, data.dealItems)));
  if (rows.length !== data.dealItems.length) throw new Error('One of the selected items no longer exists.');
  if (rows.some(r => r.isDeal)) throw new Error('A deal cannot bundle another deal.');
}

export async function POST(req: Request) {
  const business = await ownerBusiness();
  if (!business) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  try {
    const data = values(await req.json());
    await assertValidDeal(business.id, undefined, data);
    const [product] = await db.insert(products).values({ ...data, id: uid(), businessId: business.id }).returning();
    await activity(business.id, product.isDeal ? `${product.name} added as a new deal` : `${product.name} added to your menu`);
    return NextResponse.json(product);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save product.' }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const business = await ownerBusiness();
  if (!business) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  try {
    const body = await req.json();
    const data = values(body);
    await assertValidDeal(business.id, body.id, data);
    const [product] = await db.update(products).set(data).where(and(eq(products.id, body.id), eq(products.businessId, business.id))).returning();
    if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    await activity(business.id, `${product.name} updated`);
    return NextResponse.json(product);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not update product.' }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const business = await ownerBusiness();
  if (!business) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { id } = await req.json();
  const deals = await db.select({ id: products.id, name: products.name, dealItems: products.dealItems }).from(products).where(and(eq(products.businessId, business.id), eq(products.isDeal, true)));
  const usedIn = deals.find(d => d.dealItems.includes(id));
  if (usedIn) return NextResponse.json({ error: `This item is part of your "${usedIn.name}" deal. Edit or delete that deal first.` }, { status: 409 });
  const [deleted] = await db.delete(products).where(and(eq(products.id, id), eq(products.businessId, business.id))).returning();
  if (!deleted) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  await activity(business.id, `${deleted.name} removed from the menu`);
  return NextResponse.json({ ok: true });
}
