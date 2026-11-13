import { NextResponse } from 'next/server';
import { db } from '@/db';
import { assets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getUser } from '@/lib/auth';
import { signedAssetPath } from '@/lib/asset-signing';

// Owner preview (Phase 2, S6): the signed-in owner of a PRIVATE asset gets
// a temporary redirect to a short-lived signed URL (5 minutes), so previews can be opened
// or shared briefly without making the asset public. Non-owners get the
// same 404 as an unknown id — asset existence is not leaked.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) return new Response('Not found', { status: 404 });
  const [asset] = await db.select({ ownerId: assets.ownerId }).from(assets).where(eq(assets.id, id));
  if (!asset || asset.ownerId !== user.id) return new Response('Not found', { status: 404 });
  return NextResponse.redirect(new URL(signedAssetPath(id), req.url));
}
