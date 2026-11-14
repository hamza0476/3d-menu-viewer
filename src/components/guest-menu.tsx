'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { BookOpen, Box, LayoutList, Search, MapPin, ArrowUpRight, Sprout, Loader2, UtensilsCrossed, X, SlidersHorizontal, Heart, Sparkles } from 'lucide-react';
import { Brand, Empty, request, money, QRPanel } from './ui';
import { DEALS_CATEGORY, DISH_TAGS, dishTagLabel, type Business, type Product } from '@/lib/demo';
import DealViewer from './deal-viewer';
import BookMenu from './book-menu';
import DishSheet from './dish-sheet';
import { resolveGuestView, type GuestViewMode } from '@/lib/guest-book';
import { guestDir, guestStrings, isGuestLang, localizedCategory, localizedDishDescription, localizedDishName, spiceLabel, type GuestLang } from '@/lib/guest-i18n';
import type { BusinessBranding } from '@/lib/branding';
const DishViewer = dynamic(() => import('./dish-viewer'), { ssr: false, loading: () => <div className="modal-overlay"><div className="loading-card"><Loader2 className="spin" />Preparing your 3D experience…</div></div> });

// Anonymous per-session id for event de-duplication (Phase 3, S12). It is
// generated per browser session, kept only in sessionStorage, and hashed
// server-side before storage — it identifies a browsing session, never a
// person, and rotates away when the session ends.
function anonSessionId(): string {
  try {
    let sid = sessionStorage.getItem('platera-anon-session');
    if (!sid) { sid = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem('platera-anon-session', sid); }
    return sid;
  } catch { return ''; }
}
function postGuestEvent(businessId: string, table: { code: string } | null, body: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...body, sessionId: anonSessionId() };
  if (table) payload.qrCode = table.code;
  void request('/api/menu/' + businessId, 'POST', payload).catch(() => {});
}

export default function GuestMenu({ business, products, table = null, branding = { logo: null, cover: null } }: { business: Business; products: Product[]; table?: { label: string; code: string } | null; branding?: BusinessBranding }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All items');
  const [viewing, setViewing] = useState<Product | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [dietOnly, setDietOnly] = useState<string[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  // Phase 5: the book is the default guest experience. Server render and
  // first client paint agree on 'book'; the effect below downgrades to
  // the non-animated book or the classic list for reduced-motion,
  // low-end and returning guests with a stored choice (lib/guest-book).
  const [viewMode, setViewMode] = useState<GuestViewMode>('book');
  const [lang, setLang] = useState<GuestLang>('en');
  const [sheet, setSheet] = useState<Product | null>(null);
  const strings = guestStrings(lang);

  useEffect(() => {
    try { const raw = localStorage.getItem('platera-favorites-' + business.id); setFavorites(raw ? JSON.parse(raw) : []); } catch {}
    const visitKey = 'menu-visit-' + business.id + (table ? '-' + table.code : '');
    if (!sessionStorage.getItem(visitKey)) { sessionStorage.setItem(visitKey, '1'); postGuestEvent(business.id, table, {}); }
  }, [business.id, table]);

  // Phase 5: resolve the guest view + language from stored choice and
  // device signals, and register the PWA service worker. setState runs
  // inside requestAnimationFrame (a paint callback, not the effect body)
  // so the downgrade lands after first paint — the server-rendered book
  // is already the no-JS/reduced-motion-safe content underneath.
  useEffect(() => {
    let storedView: string | null = null;
    let storedLang: string | null = null;
    try { storedView = localStorage.getItem('platera-view-' + business.id); storedLang = localStorage.getItem('platera-lang'); } catch {}
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const resolved = resolveGuestView({
      stored: storedView,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      saveData: Boolean(nav.connection?.saveData),
      deviceMemory: nav.deviceMemory ?? null,
      hardwareConcurrency: nav.hardwareConcurrency ?? null,
    });
    const raf = requestAnimationFrame(() => {
      if (resolved !== 'book') setViewMode(resolved);
      if (isGuestLang(storedLang) && storedLang !== 'en') setLang(storedLang);
    });
    if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }
    return () => cancelAnimationFrame(raf);
  }, [business.id]);

  function chooseView(next: 'book' | 'list') {
    try { localStorage.setItem('platera-view-' + business.id, next); } catch {}
    if (next === 'list') { setViewMode('list'); return; }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setViewMode(reduced ? 'book-static' : 'book');
  }
  function chooseLang(next: GuestLang) {
    setLang(next);
    try { localStorage.setItem('platera-lang', next); } catch {}
  }
  // Book dish tap: the detail sheet opens (item_view fires, exactly as a
  // list tap); 3d_open fires only when the guest actually opens the 3D
  // viewer from the sheet — the Phase 4 event semantics.
  function openSheet(p: Product) { setSheet(p); postGuestEvent(business.id, table, { productId: p.id }); }
  function open3dFromSheet(p: Product) {
    setSheet(null);
    setViewing(p);
    if (p.model3d && (p.model3d.low || p.model3d.high)) postGuestEvent(business.id, table, { productId: p.id, type: '3d_open' });
  }

  function view(p: Product) { setViewing(p); postGuestEvent(business.id, table, { productId: p.id }); if (p.model3d && (p.model3d.low || p.model3d.high)) postGuestEvent(business.id, table, { productId: p.id, type: '3d_open' }); }
  function toggleFavorite(pid: string) { setFavorites(prev => { const next = prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]; try { localStorage.setItem('platera-favorites-' + business.id, JSON.stringify(next)); } catch {} return next; }); }
  function toggleAvoid(t: string) { setAvoid(v => v.includes(t) ? v.filter(x => x !== t) : [...v, t]); }
  function toggleDiet(t: string) { setDietOnly(v => v.includes(t) ? v.filter(x => x !== t) : [...v, t]); }
  function resetAll() { setCategory('All items'); setSearch(''); setAvoid([]); setDietOnly([]); setFavOnly(false); }

  const filtered = products.filter(p =>
    (category === 'All items' || p.category === category) &&
    (p.name.toLowerCase().includes(search.toLowerCase()) || (p.nameUr || '').includes(search) || (p.descriptionUr || '').includes(search)) &&
    !avoid.some(a => p.tags.includes(a)) &&
    dietOnly.every(d => p.tags.includes(d)) &&
    (!favOnly || favorites.includes(p.id))
  );
  const activeFilters = avoid.length + dietOnly.length + (favOnly ? 1 : 0);

  return (
    <div className="guest-page">
      <header className="guest-header">
        <a href="/" aria-label="Platera home"><Brand /></a>
        <span className="guest-header-note"><UtensilsCrossed size={15} />Made for delicious discoveries.</span>
        <a href="/" className="text-link">For restaurant owners <ArrowUpRight size={15} /></a>
      </header>
      {table && (
        <div dir={guestDir(lang)} style={{ background: '#294c3b', color: '#fff', textAlign: 'center', padding: '10px 16px', fontSize: 14 }}>
          {strings.youreAt} <strong>{table.label}</strong> · {business.name}, {business.city}
        </div>
      )}
      <div className="guest-controls">
        {viewMode !== 'list' && (
          <button className="btn" onClick={() => chooseView('list')} aria-label={strings.searchDishes}><Search size={15} />{strings.searchDishes}</button>
        )}
        <div className="view-toggle" role="group" aria-label="Menu view">
          <button className={viewMode !== 'list' ? 'selected' : ''} onClick={() => chooseView('book')} aria-pressed={viewMode !== 'list'}><BookOpen size={15} />{strings.bookView}</button>
          <button className={viewMode === 'list' ? 'selected' : ''} onClick={() => chooseView('list')} aria-pressed={viewMode === 'list'}><LayoutList size={15} />{strings.listView}</button>
        </div>
        <button className="btn lang-toggle" onClick={() => chooseLang(lang === 'en' ? 'ur' : 'en')} aria-label="Switch language">{lang === 'en' ? 'اردو' : 'EN'}</button>
      </div>
      {viewMode !== 'list' ? (
        <BookMenu
          business={business}
          branding={branding}
          products={products}
          lang={lang}
          strings={strings}
          mode={viewMode}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onOpenDish={openSheet}
          onOpenDeal={view}
        />
      ) : (
      <>
      <div className="guest-qr-section">
        <div className="guest-qr-inner">
          <QRPanel id={business.id} name={business.name} compact />
          <div className="guest-qr-text">
            <h3>Scan to share</h3>
            <p>Show this QR code to your guests. They scan, explore, and discover your menu — no app needed.</p>
          </div>
        </div>
      </div>
      <section className="guest-hero">
        <img src="/images/menu-hero.jpg" alt="A freshly prepared grain bowl" loading="eager" />
        <div>
          <span className="eyebrow"><Sprout size={16} /> WELCOME TO YOUR TABLE</span>
          <h1>{business.name}</h1>
          <p>{business.tagline}</p>
          <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(business.address + ', ' + business.city)} target="_blank" rel="noreferrer"><MapPin size={15} />{business.city}, {business.province}<ArrowUpRight size={14} /></a>
        </div>
      </section>
      <main className="guest-main">
        <div className="guest-intro">
          <div><h2>Find your next favorite.</h2><p>Freshly made, thoughtfully served. Tap a dish to explore it in 3D.</p></div>
          <span className="guest-3d-note"><Box size={18} /> A menu with a little more dimension.</span>
        </div>
        <div className="menu-toolbar">
          <div className="category-tabs">{['All items', ...(products.some(p => p.isDeal) ? [DEALS_CATEGORY] : []), ...business.categories].map(c => <button key={c} onClick={() => setCategory(c)} className={category === c ? 'selected' : ''}>{c === DEALS_CATEGORY ? strings.deals : c === 'All items' ? c : localizedCategory(c, business.categories, business.categoriesUr, lang)}</button>)}</div>
          <div className="menu-tools">
            <div className="search-input"><Search size={16} /><input placeholder="What are you craving?" aria-label="Search dishes" value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="icon-btn" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</div>
            <button className={'btn filter-btn ' + (showFilters ? 'selected' : '')} aria-label="Dietary filters" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={16} />{activeFilters > 0 && <span className="count-badge">{activeFilters}</span>}</button>
          </div>
        </div>
        {showFilters && (
          <div className="filter-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 16 }}>
            <div><strong style={{ fontSize: 11 }}>Dietary preferences</strong><div className="category-tabs" style={{ marginTop: 8 }}>{DISH_TAGS.filter(t => t.group === 'diet').map(t => <button type="button" key={t.id} className={dietOnly.includes(t.id) ? 'selected' : ''} onClick={() => toggleDiet(t.id)}>{t.label}</button>)}</div></div>
            <div><strong style={{ fontSize: 11 }}>Avoid these allergens</strong><div className="category-tabs" style={{ marginTop: 8 }}>{DISH_TAGS.filter(t => t.group === 'allergen').map(t => <button type="button" key={t.id} className={avoid.includes(t.id) ? 'selected' : ''} onClick={() => toggleAvoid(t.id)}>{t.label}</button>)}</div></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="check-label"><input type="checkbox" checked={favOnly} onChange={e => setFavOnly(e.target.checked)} /> <Heart size={13} style={{ marginRight: 3 }} /> Favorites only</label>
              <button className="text-link" onClick={resetAll}>Reset filters</button>
            </div>
          </div>
        )}
        <div className="results-label"><span>{filtered.length} {filtered.length === 1 ? 'dish' : 'dishes'}</span></div>
        <div className="guest-products">
          {filtered.map(p => (
            <article key={p.id} className="guest-product">
              <div className="product-photo" onClick={() => view(p)}>
                <img src={p.image || '/images/menu-hero.jpg'} alt={p.name} loading="lazy" sizes="(max-width: 768px) 100vw, 300px" />
                <span className="product-badge">{p.isDeal ? <><Sparkles size={13} />{'Deal · ' + p.dealItems.length + ' items'}</> : <><Box size={13} />{p.model ? 'Explore in 3D' : '3D preview'}</>}</span>
                <button className="icon-btn" style={{ position: 'absolute', top: 10, right: 10, background: '#ffffffd9' }} onClick={e => { e.stopPropagation(); toggleFavorite(p.id); }} aria-label={favorites.includes(p.id) ? 'Remove from favorites' : 'Add to favorites'}>
                  <Heart size={16} fill={favorites.includes(p.id) ? '#ab4c43' : 'none'} color={favorites.includes(p.id) ? '#ab4c43' : 'currentColor'} />
                </button>
              </div>
              <div className="guest-product-content" onClick={() => view(p)} style={{ cursor: 'pointer' }}>
                <span className="eyebrow">{p.isDeal ? strings.deals : localizedCategory(p.category, business.categories, business.categoriesUr, lang)}</span>
                {p.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 0' }}>{p.tags.slice(0, 3).map(t => <span key={t} className="status-pill">{dishTagLabel(t)}</span>)}</div>}
                <div><h3 dir="auto">{localizedDishName(p, lang)}</h3><div className="price-row">{p.originalPrice ? <span className="was">{money(p.originalPrice, business.currency)}</span> : null}<strong>{money(p.price, business.currency)}</strong></div></div>
                <p dir="auto">{localizedDishDescription(p, lang)}</p>
                {(spiceLabel(p.spiceLevel, lang) || p.serves) && <p className="dish-meta">{spiceLabel(p.spiceLevel, lang) ? <span>{strings.spiceLevel}: {spiceLabel(p.spiceLevel, lang)}</span> : null}{p.serves ? <span dir="auto">{strings.serves}: {p.serves}</span> : null}</p>}
                <span className="text-link">{p.isDeal ? "See what's included" : 'Take a closer look'} <ArrowUpRight size={15} /></span>
              </div>
            </article>
          ))}
        </div>
        {!filtered.length && <Empty title="Nothing matches just yet." text="Try another category, search term, or loosen your filters."><button className="btn" onClick={resetAll}>Reset filters</button></Empty>}
        <div className="guest-food-note"><Sprout size={22} /><p>Good food, good company, and a little curiosity.<br /><span>Dietary tags are set by the restaurant as a helpful guide — please still let your server know about any allergies.</span></p></div>
      </main>
      </>
      )}
      <footer className="guest-footer"><Brand small /><span>A little more than a menu.</span><span>{strings.pricesIn} {business.currency} · {business.name}</span></footer>
      {sheet && <DishSheet product={sheet} currency={business.currency} strings={strings} lang={lang} categories={business.categories} categoriesUr={business.categoriesUr} isFavorite={favorites.includes(sheet.id)} onToggleFavorite={toggleFavorite} onView3d={open3dFromSheet} onClose={() => setSheet(null)} />}
      {viewing && (viewing.isDeal ? <DealViewer deal={viewing} items={products} currency={business.currency} onClose={() => setViewing(null)} onOpenItem={item => { postGuestEvent(business.id, table, { productId: item.id }); }} /> : <DishViewer product={viewing} currency={business.currency} onClose={() => setViewing(null)} />)}
    </div>
  );
}
