import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { businesses, products } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import GuestMenu from '@/components/guest-menu';
import type { CurrencyCode } from '@/lib/demo';
import { resolveQr } from '@/lib/qr-data';
import { attachModelBundles } from '@/lib/model-data';
import { getBusinessBranding } from '@/lib/branding';
import { isQrCodeShape } from '@/lib/qr';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.published, true), eq(businesses.suspended, false)));
  if (!business) return { title: 'Menu not found · Platera' };
  const title = `${business.name} · Digital Menu`;
  const description = business.tagline || `View the interactive 3D menu for ${business.name} in ${business.city}.`;
  return {
    title,
    description,
    // Phase 5: per-restaurant PWA manifest (title/OG unchanged).
    manifest: `/menu/${id}/manifest.webmanifest`,
    openGraph: { title, description, type: 'website', images: ['/images/menu-hero.jpg'] },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function MenuPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.published, true), eq(businesses.suspended, false)));
  if (!business) notFound();
  // Table context (Phase 3): guests who arrived via a table QR land here
  // with ?t=<code> after the /m/<code> resolver. An invalid or foreign code
  // simply means "no table context" — the menu itself never breaks.
  let table: { label: string; code: string } | null = null;
  if (isQrCodeShape(t)) {
    const resolved = await resolveQr(t);
    if (resolved && resolved.business.id === id && resolved.table) table = { label: resolved.table.label, code: resolved.qr.code };
  }
  const items = await attachModelBundles(await db.select().from(products).where(and(eq(products.businessId, id), eq(products.available, true))));
  const branding = await getBusinessBranding(id);
  return (
    <GuestMenu
      table={table}
      branding={branding}
      business={{
        id: business.id, name: business.name, tagline: business.tagline,
        city: business.city, address: business.address, province: business.province,
        phone: business.phone, currency: business.currency as CurrencyCode,
        published: business.published, suspended: business.suspended,
        categories: (business.categories as string[]) || ['Starters', 'Main courses', 'Desserts', 'Drinks']
      }}
      products={items.map(p => ({
        id: p.id, businessId: p.businessId, name: p.name,
        description: p.description, price: p.price, originalPrice: p.originalPrice,
        category: p.category, image: p.image,
        photos: (p.photos as string[]) || [],
        tags: (p.tags as string[]) || [], model: p.model,
        available: p.available, isDeal: p.isDeal,
        dealItems: (p.dealItems as string[]) || [],
        views: p.views, createdAt: p.createdAt?.toISOString()
      }))}
    />
  );
}
