'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles, Box, Loader2, ArrowUpRight } from 'lucide-react';
import { Modal, money } from './ui';
import type { Product } from '@/lib/demo';

const ProductViewer = dynamic(() => import('./product-viewer'), { ssr: false, loading: () => <div className="modal-overlay"><div className="loading-card"><Loader2 className="spin" />Preparing your 3D experience…</div></div> });

export default function DealViewer({ deal, items, currency = 'USD', onClose, onOpenItem }: { deal: Product; items: Product[]; currency?: string; onClose: () => void; onOpenItem?: (p: Product) => void }) {
  const [subViewing, setSubViewing] = useState<Product | null>(null);
  const included = deal.dealItems.map(id => items.find(p => p.id === id)).filter((p): p is Product => Boolean(p));

  return (
    <Modal title={deal.name} subtitle="A combo built from items already on this menu." onClose={onClose} wide>
      <div className="form-body" style={{ paddingBottom: 6 }}>
        <span className="deal-badge"><Sparkles size={11} /> DEAL · {included.length} items</span>
        <p style={{ fontSize: 12, color: '#8a977e', margin: '12px 0 0', lineHeight: 1.8 }}>{deal.description}</p>
      </div>
      <div className="viewer-details" style={{ paddingTop: 6 }}>
        <span className="eyebrow">Bundle price</span>
        <div className="price-row">
          {deal.originalPrice ? <span className="was">{money(deal.originalPrice, currency)}</span> : null}
          <strong>{money(deal.price, currency)}</strong>
        </div>
      </div>
      <div className="deal-items-grid">
        {included.map(item => (
          <button key={item.id} className="deal-item-card" onClick={() => { setSubViewing(item); onOpenItem?.(item); }}>
            <img src={item.image || '/images/menu-hero.jpg'} alt={item.name} />
            <span>
              <strong>{item.name}</strong>
              <em>{money(item.price, currency)}</em>
              <small><Box size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{item.model ? 'View in 3D' : '3D preview'} <ArrowUpRight size={10} style={{ verticalAlign: -1 }} /></small>
            </span>
          </button>
        ))}
      </div>
      <div className="viewer-disclaimer"><Sparkles size={13} />Tap any item above to open its own real 3D preview, exactly like it appears elsewhere on the menu.</div>
      {subViewing && <ProductViewer product={subViewing} currency={currency} onClose={() => setSubViewing(null)} />}
    </Modal>
  );
}
