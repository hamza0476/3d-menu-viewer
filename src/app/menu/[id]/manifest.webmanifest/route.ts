import { NextResponse } from 'next/server';
import { db } from '@/db';
import { businesses } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getBusinessBranding } from '@/lib/branding';

// Per-restaurant PWA manifest (Phase 5): the guest menu is installable
// under the restaurant's own name, scoped to its menu path, so a repeat
// guest's home-screen icon opens this menu — not the Platera platform.
// Icons come from the owner's uploaded logo when one exists; without a
// logo the manifest simply has no icons (valid, just not installable —
// stated in DECISIONS.md rather than faked with a food photo).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.published, true), eq(businesses.suspended, false)));
  if (!business) return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const branding = await getBusinessBranding(id);
  const manifest = {
    name: `${business.name} · Digital Menu`,
    short_name: business.name.slice(0, 24),
    description: business.tagline || `View the interactive menu for ${business.name}.`,
    start_url: `/menu/${id}`,
    scope: `/menu/${id}`,
    display: 'standalone',
    background_color: '#fafbf7',
    theme_color: '#2b4c39',
    icons: branding.logo ? [{ src: branding.logo, sizes: '512x512', type: 'image/png', purpose: 'any' }] : [],
  };
  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
}
