import { db } from '@/db';
import { assets, itemModels, products, businesses } from '@/db/schema';
import { and, eq, or, sql } from 'drizzle-orm';
import { getUser } from '@/lib/auth';
import { storageGet } from '@/lib/storage';
import { verifyAssetSignature } from '@/lib/asset-signing';

// Asset serving with access control (Phase 2, fixes S6).
//
// Before Phase 2 anyone who learned an asset ID could fetch the file —
// including GLBs of UNPUBLISHED restaurants — with a 1-year immutable
// public cache header. Now an asset is public only while it is referenced
// by a menu item of a published, non-suspended restaurant (that is what
// the guest menu loads). Everything else is private and requires either
// the owner's session or a short-lived signed URL (see ./preview).
// Private bytes are never sent with a public/immutable cache header, and
// unknown-or-forbidden ids both answer 404 so ids cannot be probed.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [asset] = await db.select().from(assets).where(eq(assets.id, id));
  if (!asset) return new Response('Not found', { status: 404 });

  const url = '/api/assets/' + id;
  const [publishedRef] = await db
    .select({ productId: products.id })
    .from(products)
    .innerJoin(businesses, eq(businesses.id, products.businessId))
    .where(
      and(
        eq(businesses.published, true),
        eq(businesses.suspended, false),
        or(eq(products.image, url), eq(products.model, url), sql`${products.photos} @> ${JSON.stringify([url])}::jsonb`),
      ),
    )
    .limit(1);

  // Phase 4: processed model variants + posters are referenced from
  // item_models, not from the product row — they are public while the
  // item's model is 'ready' on a published, non-suspended menu (exactly
  // the set the guest menu payload hands out).
  const [publishedModelRef] = await db
    .select({ itemId: itemModels.itemId })
    .from(itemModels)
    .innerJoin(products, eq(products.id, itemModels.itemId))
    .innerJoin(businesses, eq(businesses.id, products.businessId))
    .where(
      and(
        eq(businesses.published, true),
        eq(businesses.suspended, false),
        eq(itemModels.status, 'ready'),
        or(
          eq(itemModels.highAssetId, id),
          eq(itemModels.lowAssetId, id),
          eq(itemModels.usdzAssetId, id),
          eq(itemModels.posterAssetId, id),
        ),
      ),
    )
    .limit(1);

  const isPublic = Boolean(publishedRef) || Boolean(publishedModelRef);
  let cacheControl: string;
  if (isPublic) {
    cacheControl = 'public, max-age=31536000, immutable';
  } else {
    const reqUrl = new URL(req.url);
    const signed = verifyAssetSignature(id, reqUrl.searchParams.get('exp'), reqUrl.searchParams.get('sig'));
    if (!signed) {
      const user = await getUser();
      if (!user || user.id !== asset.ownerId) return new Response('Not found', { status: 404 });
    }
    cacheControl = 'private, no-store';
  }

  const data = await storageGet(asset.storageKey);
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': asset.mime,
      'Content-Length': String(data.length),
      ETag: `"${asset.sha256}"`,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
