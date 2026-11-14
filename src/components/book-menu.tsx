'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, ChevronLeft, ChevronRight, Heart, Sparkles } from 'lucide-react';
import { Brand, money } from './ui';
import { dishTagLabel, type Business, type Product } from '@/lib/demo';
import { buildBook } from '@/lib/guest-book';
import { guestDir, type GuestLang, type GuestStrings } from '@/lib/guest-i18n';
import type { BusinessBranding } from '@/lib/branding';

// The Book Menu (Phase 5 — fixes G1): a cover, then one chapter per
// category paginated into spreads, with a thumb index, tap-edge / swipe
// / button page turns, and dish cards that open the detail sheet.
//
// Hand-rolled on CSS 3D transforms — no page-flip library. The flip
// libraries evaluated either ship a canvas renderer (breaks text
// selection, RTL and the no-JS fallback) or pin framework versions this
// repo does not run; the plan's acceptance is a premium-feeling turn,
// which a GPU rotateY with a spine shadow delivers. See DECISIONS.md.
//
// Two modes share this markup:
//   book        — one spread at a time, animated turn.
//   book-static — every spread stacked in flow, chapters jump by
//                 scroll. This is also exactly what a no-JS browser
//                 gets from the server render: the book degrades to a
//                 readable, complete menu, never a blank shell.
export default function BookMenu({ business, branding, products, lang, strings, mode, favorites, onToggleFavorite, onOpenDish, onOpenDeal }: {
  business: Business;
  branding: BusinessBranding;
  products: Product[];
  lang: GuestLang;
  strings: GuestStrings;
  mode: 'book' | 'book-static';
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onOpenDish: (p: Product) => void;
  onOpenDeal: (p: Product) => void;
}) {
  const book = useMemo(() => buildBook(products, business.categories, strings.moreFromTheKitchen), [products, business.categories, strings]);
  const [page, setPage] = useState(0); // 0 = cover; 1..N = spreads[page-1]
  const [turning, setTurning] = useState<{ to: number; dir: 'next' | 'prev' } | null>(null);
  // Server render (and every first paint) is the STACKED book: complete
  // content for no-JS browsers, crawlers and slow devices. The animated
  // single-spread stage takes over after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const touchX = useRef<number | null>(null);
  const totalSheets = book.spreads.length + 1;
  const animated = mode === 'book' && mounted;

  function goTo(target: number) {
    const clamped = Math.max(0, Math.min(totalSheets - 1, target));
    if (clamped === page || turning) return;
    if (!animated) { setPage(clamped); return; }
    setTurning({ to: clamped, dir: clamped > page ? 'next' : 'prev' });
    window.setTimeout(() => { setPage(clamped); setTurning(null); }, 470);
  }
  function jumpToChapter(firstSpread: number) {
    const target = firstSpread + 1;
    if (!animated) {
      setPage(target);
      document.getElementById('book-sheet-' + target)?.scrollIntoView({ behavior: 'auto', block: 'start' });
      return;
    }
    goTo(target);
  }

  const currentSpread = page >= 1 ? book.spreads[page - 1] : null;
  const activeChapter = currentSpread ? currentSpread.chapter : null;

  function dishCard(p: Product) {
    const photo = (p.model3d && p.model3d.poster) || p.image || '/images/menu-hero.jpg';
    return (
      <article key={p.id} className="book-card" data-dish-id={p.id}>
        <div className="book-card-photo" onClick={() => (p.isDeal ? onOpenDeal(p) : onOpenDish(p))}>
          {/* eslint-disable-next-line @next/next/no-img-element -- guest dish photo/poster, must paint instantly, same call as the guest grid */}
          <img src={photo} alt={p.name} loading="lazy" />
          <span className="product-badge">{p.isDeal ? <><Sparkles size={13} />Deal</> : <><Box size={13} />3D</>}</span>
          <button className="icon-btn book-fav" onClick={e => { e.stopPropagation(); onToggleFavorite(p.id); }} aria-label={favorites.includes(p.id) ? strings.removeFromFavorites : strings.addToFavorites}>
            <Heart size={15} fill={favorites.includes(p.id) ? '#ab4c43' : 'none'} color={favorites.includes(p.id) ? '#ab4c43' : 'currentColor'} />
          </button>
        </div>
        <div className="book-card-body" onClick={() => (p.isDeal ? onOpenDeal(p) : onOpenDish(p))}>
          <h3 dir="auto">{p.name}</h3>
          <p dir="auto">{p.description}</p>
          <div className="book-card-foot">
            <span className="book-price">{p.originalPrice ? <span className="was">{money(p.originalPrice, business.currency)}</span> : null}<strong>{money(p.price, business.currency)}</strong></span>
            {p.tags.length > 0 && <span className="book-tags">{p.tags.slice(0, 2).map(t => <span key={t} className="status-pill">{dishTagLabel(t)}</span>)}</span>}
          </div>
        </div>
      </article>
    );
  }

  function coverSheet(cls: string) {
    return (
      <div className={'book-sheet book-cover ' + cls} data-book-cover key="cover">
        {/* eslint-disable-next-line @next/next/no-img-element -- cover photo, first paint of the book */}
        <img className="book-cover-img" src={branding.cover || '/images/menu-hero.jpg'} alt="" />
        <div className="book-cover-shade" />
        <div className="book-cover-body">
          {branding.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- owner logo asset
            <img className="book-cover-logo" src={branding.logo} alt={business.name} />
          ) : (
            <span className="book-cover-brand"><Brand small /></span>
          )}
          <span className="eyebrow" style={{ color: '#d8e2c8' }}>{strings.welcomeToYourTable}</span>
          <h1 dir="auto">{business.name}</h1>
          <p dir="auto">{business.tagline}</p>
          <span className="book-cover-city">{business.city}, {business.province}</span>
          <button className="btn primary book-open-btn" onClick={() => goTo(1)}>{strings.tapToOpen}</button>
        </div>
      </div>
    );
  }

  function spreadSheet(spreadIndex: number, cls: string) {
    const spread = book.spreads[spreadIndex];
    if (!spread) return null;
    return (
      <div className={'book-sheet book-spread ' + cls} data-spread-index={spreadIndex} id={'book-sheet-' + (spreadIndex + 1)} key={spreadIndex}>
        <header className="book-spread-head">
          <span className="eyebrow" dir="auto">{spread.chapter}</span>
          <span className="book-spread-count">{strings.page} {spread.pageInChapter + 1} {strings.of} {spread.chapterPages}</span>
        </header>
        <div className="book-grid">{spread.items.map(dishCard)}</div>
        <footer className="book-spread-foot"><span dir="auto">{business.name}</span><span>{spreadIndex + 2} / {totalSheets}</span></footer>
      </div>
    );
  }

  return (
    <div className="book-wrap" dir={guestDir(lang)} lang={lang} data-book-mode={mode}>
      <div className="book-shell">
        <nav className="book-index" aria-label={strings.chapters}>
          <span className="book-index-label">{strings.chapters}</span>
          {book.chapters.map(ch => (
            <button key={ch.name} className={'book-tab' + (activeChapter === ch.name ? ' active' : '')} onClick={() => jumpToChapter(ch.firstSpread)}>
              <span dir="auto">{ch.name}</span><small>{ch.dishes}</small>
            </button>
          ))}
        </nav>
        <div>
          <div
            className={'book-stage' + (animated ? ' book-anim' : ' book-static')}
            data-page={page}
            data-chapter={activeChapter || ''}
            tabIndex={0}
            role="region"
            aria-label={business.name}
            onKeyDown={e => { if (e.key === 'ArrowRight') goTo(page + 1); if (e.key === 'ArrowLeft') goTo(page - 1); }}
            onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              if (touchX.current === null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              touchX.current = null;
              if (Math.abs(dx) < 48) return;
              goTo(page + (dx < 0 ? 1 : -1));
            }}
          >
            {animated ? (
              turning ? (
                <>
                  {turning.to === 0 ? coverSheet('book-under') : spreadSheet(turning.to - 1, 'book-under')}
                  {page === 0 ? coverSheet('book-leaving-' + turning.dir) : spreadSheet(page - 1, 'book-leaving-' + turning.dir)}
                </>
              ) : (
                page === 0 ? coverSheet('book-current') : spreadSheet(page - 1, 'book-current')
              )
            ) : (
              <>
                {coverSheet('')}
                {book.spreads.map((_, i) => spreadSheet(i, ''))}
              </>
            )}
          </div>
          {animated && (
            <div className="book-controls">
              <button className="btn" onClick={() => goTo(page - 1)} disabled={page === 0} aria-label={strings.prevPage}><ChevronLeft size={15} />{strings.prevPage}</button>
              <span className="book-progress">{page + 1} / {totalSheets}</span>
              <button className="btn" onClick={() => goTo(page + 1)} disabled={page === totalSheets - 1} aria-label={strings.nextPage}>{strings.nextPage}<ChevronRight size={15} /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
