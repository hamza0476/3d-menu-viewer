import { db } from '@/db';
import { assets } from '@/db/schema';
import { eq } from 'drizzle-orm';
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const [asset] = await db.select().from(assets).where(eq(assets.id, id)); if (!asset) return new Response('Not found', { status: 404 }); return new Response(Buffer.from(asset.data, 'base64'), { headers: { 'Content-Type': asset.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } }); }
