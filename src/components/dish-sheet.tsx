'use client';
import { useState } from 'react';
import { Box, Heart, Info, Sparkles } from 'lucide-react';
import { Modal, money } from './ui';
import { DISH_TAGS, dishTagLabel, type Product } from '@/lib/demo';
import { localizedCategory, localizedDishDescription, localizedDishName, spiceLabel, type GuestLang, type GuestStrings } from '@/lib/guest-i18n';
import { DEALS_CATEGORY } from '@/lib/demo';

// Dish detail sheet (Phase 5): what a guest sees when they tap a dish in
// the book — big photo, full description, price, the dietary/allergen
// tags split by meaning, and the entry into the Phase 4 viewer. The
// sheet itself is not the 3D viewer: "View in 3D" hands over to the
// existing DishViewer (progressive bundle or classic fallback), which is
// also the moment the 3d_open event fires — opening this sheet fired
// item_view, exactly like tapping a dish in the list view.
export default function DishSheet({ product, currency, strings, lang = 'en', categories = [], categoriesUr = null, isFavorite, onToggleFavorite, onView3d, onClose }: {
  product: Product;
  currency: string;
  strings: GuestStrings;
  lang?: GuestLang;
  categories?: string[];
  categoriesUr?: (string | null)[] | null;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onView3d: (p: Product) => void;
  onClose: () => void;
}) {
  const photos = Array.from(new Set([product.image, ...(product.photos || [])].filter(Boolean)));
  const [photo, setPhoto] = useState(photos[0] || '/images/menu-hero.jpg');
  const diet = product.tags.filter(t => DISH_TAGS.find(d => d.id === t)?.group === 'diet');
  const allergens = product.tags.filter(t => DISH_TAGS.find(d => d.id === t)?.group === 'allergen');
  const hasReal3d = Boolean(product.model || (product.model3d && (product.model3d.low || product.model3d.high)));

  return (
    <Modal title={localizedDishName(product, lang)} subtitle={product.isDeal ? strings.deals : localizedCategory(product.category, categories, categoriesUr, lang)} onClose={onClose}>
      <div style={{ position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- guest dish photo, same call as the guest grid */}
        <img src={photo} alt={product.name} style={{ width: '100%', height: 250, objectFit: 'cover', display: 'block' }} />
        <button className="icon-btn" style={{ position: 'absolute', top: 10, right: 10, background: '#ffffffd9' }} onClick={() => onToggleFavorite(product.id)} aria-label={isFavorite ? strings.removeFromFavorites : strings.addToFavorites}>
          <Heart size={16} fill={isFavorite ? '#ab4c43' : 'none'} color={isFavorite ? '#ab4c43' : 'currentColor'} />
        </button>
      </div>
      {photos.length > 1 && (
        <div className="photo-strip" style={{ padding: '10px 25px 0' }}>
          {photos.map(src => (
            // eslint-disable-next-line @next/next/no-img-element -- thumbnail strip, same call as above
            <img key={src} src={src} alt="" onClick={() => setPhoto(src)} style={{ borderColor: src === photo ? '#608149' : undefined, borderWidth: src === photo ? 2 : 1 }} />
          ))}
        </div>
      )}
      <div style={{ padding: '18px 25px 6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
          <h3 dir="auto" style={{ fontSize: 17, letterSpacing: '-.3px' }}>{localizedDishName(product, lang)}</h3>
          <div className="price-row" style={{ whiteSpace: 'nowrap' }}>
            {product.originalPrice ? <span className="was">{money(product.originalPrice, currency)}</span> : null}
            <strong style={{ fontSize: 16 }}>{money(product.price, currency)}</strong>
          </div>
        </div>
        <p dir="auto" style={{ fontSize: 12, color: '#7d8b70', lineHeight: 1.85, marginTop: 8 }}>{localizedDishDescription(product, lang)}</p>
        {(spiceLabel(product.spiceLevel, lang) || product.serves) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 10, fontSize: 12, color: '#5c6d52' }}>
            {spiceLabel(product.spiceLevel, lang) && <span><strong style={{ color: '#718163' }}>{strings.spiceLevel}:</strong> {spiceLabel(product.spiceLevel, lang)}</span>}
            {product.serves && <span dir="auto"><strong style={{ color: '#718163' }}>{strings.serves}:</strong> {product.serves}</span>}
          </div>
        )}
        {product.isDeal && product.dealItems.length > 0 && (
          <p style={{ fontSize: 11, color: '#7d8b70', marginTop: 8 }}><Sparkles size={13} /> {product.dealItems.length} {strings.dishes}</p>
        )}
        {diet.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 10, color: '#718163' }}>{strings.goodFor}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>{diet.map(t => <span key={t} className="status-pill">{dishTagLabel(t)}</span>)}</div>
          </div>
        )}
        {allergens.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 10, color: '#a06a55' }}>{strings.contains}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>{allergens.map(t => <span key={t} className="status-pill">{dishTagLabel(t)}</span>)}</div>
          </div>
        )}
        <button className="btn primary full" style={{ marginTop: 18 }} onClick={() => onView3d(product)}>
          <Box size={16} /> {hasReal3d ? strings.viewIn3d : strings.illustrative3d}
        </button>
        <div className="viewer-disclaimer" style={{ padding: '14px 0 20px' }}>
          <Info size={15} /><span>{strings.allergenNote}</span>
        </div>
      </div>
    </Modal>
  );
}
