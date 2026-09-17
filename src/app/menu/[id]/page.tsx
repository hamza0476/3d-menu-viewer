import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { businesses, products } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import GuestMenu from '@/components/guest-menu';
import type { CurrencyCode } from '@/lib/demo';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.published, true), eq(businesses.suspended, false)));
  if (!business) return { title: 'Menu not found · Platera' };
  const title = `${business.name} · Digital Menu`;
  const description = business.tagline || `View the interactive 3D menu for ${business.name} in ${business.city}.`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', images: ['/images/menu-hero.jpg'] },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.published, true), eq(businesses.suspended, false)));
  if (!business) notFound();
  const items = await db.select().from(products).where(and(eq(products.businessId, id), eq(products.available, true)));
  return (
    <GuestMenu
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
