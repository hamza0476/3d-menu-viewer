import { NextResponse } from 'next/server';
import { db } from '@/db';
import { products } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { uid, activity } from '@/lib/auth';
import { requireMembership, roleAllowed } from '@/lib/tenancy';
import { assetIdFromUrl, clearModelTracking, enqueueModelJob } from '@/lib/model-pipeline';
import { DISH_TAG_IDS, DEALS_CATEGORY, SPICE_LEVELS } from '@/lib/demo';

// Phase 4: keep the 3D pipeline in step with the item's model URL. A new
// or changed GLB queues a processing job; removing the model clears the
// tracking. Best-effort by design — a pipeline hiccup must never fail the
// owner's save (the 3D Studio has a manual Process/Retry button too).
async function syncModelTracking(businessId: string, itemId: string, newModel: string | null, previousModel: string | null) {
  try {
    const next = assetIdFromUrl(newModel);
    const prev = assetIdFromUrl(previousModel);
    if (next && next !== prev) await enqueueModelJob(businessId, itemId);
    else if (!next && prev) await clearModelTracking(businessId, itemId);
  } catch (e) {
    console.error('[products] model tracking sync failed:', e);
  }
}

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
  // Phase 6: Urdu name/description (empty -> null, guests fall back to
  // English per field), spice level (closed list) and a free-text serves
  // note ("Serves 2–3", "Family pack").
  const urduText = (v: unknown, max: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  return {
    name: b.name.trim().slice(0, 120),
    nameUr: urduText(b.nameUr, 120),
    descriptionUr: urduText(b.descriptionUr, 2000),
    spiceLevel: typeof b.spiceLevel === 'string' && (SPICE_LEVELS as readonly string[]).includes(b.spiceLevel) ? b.spiceLevel : null,
    serves: urduText(b.serves, 40),
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
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const business = membership.business;
  if (!roleAllowed(membership.role, 'manager')) return NextResponse.json({ error: 'Your role does not allow this. Ask the owner or a manager.' }, { status: 403 });
  try {
    const data = values(await req.json());
    await assertValidDeal(business.id, undefined, data);
    const [product] = await db.insert(products).values({ ...data, id: uid(), businessId: business.id }).returning();
    await syncModelTracking(business.id, product.id, product.model, null);
    await activity(business.id, product.isDeal ? `${product.name} added as a new deal` : `${product.name} added to your menu`);
    return NextResponse.json(product);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save product.' }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const business = membership.business;
  try {
    const body = await req.json();
    if (!roleAllowed(membership.role, 'manager')) {
      // Staff (plan §6): availability toggles only — an {id, available}
      // body and nothing else. Anything richer is a menu edit.
      const keys = Object.keys(body).filter((k) => k !== 'id');
      if (!(typeof body.id === 'string' && keys.length === 1 && keys[0] === 'available' && typeof body.available === 'boolean')) return NextResponse.json({ error: 'Staff can only change dish availability.' }, { status: 403 });
      const [toggled] = await db.update(products).set({ available: body.available }).where(and(eq(products.id, body.id), eq(products.businessId, business.id))).returning();
      if (!toggled) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
      await activity(business.id, `${toggled.name} marked ${toggled.available ? 'available' : 'unavailable'}`);
      return NextResponse.json(toggled);
    }
    const data = values(body);
    await assertValidDeal(business.id, body.id, data);
    const [previous] = await db.select({ model: products.model }).from(products).where(and(eq(products.id, body.id), eq(products.businessId, business.id)));
    const [product] = await db.update(products).set(data).where(and(eq(products.id, body.id), eq(products.businessId, business.id))).returning();
    if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    await syncModelTracking(business.id, product.id, product.model, previous?.model ?? null);
    await activity(business.id, `${product.name} updated`);
    return NextResponse.json(product);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not update product.' }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const business = membership.business;
  if (!roleAllowed(membership.role, 'manager')) return NextResponse.json({ error: 'Your role does not allow this. Ask the owner or a manager.' }, { status: 403 });
  const { id } = await req.json();
  const deals = await db.select({ id: products.id, name: products.name, dealItems: products.dealItems }).from(products).where(and(eq(products.businessId, business.id), eq(products.isDeal, true)));
  const usedIn = deals.find(d => d.dealItems.includes(id));
  if (usedIn) return NextResponse.json({ error: `This item is part of your "${usedIn.name}" deal. Edit or delete that deal first.` }, { status: 409 });
  const [deleted] = await db.delete(products).where(and(eq(products.id, id), eq(products.businessId, business.id))).returning();
  if (!deleted) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  await activity(business.id, `${deleted.name} removed from the menu`);
  return NextResponse.json({ ok: true });
}
