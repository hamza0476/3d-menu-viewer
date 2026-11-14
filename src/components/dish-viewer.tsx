'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { Product } from '@/lib/demo';

const ProductViewer = dynamic(() => import('./product-viewer'), { ssr: false, loading: () => <div className="modal-overlay"><div className="loading-card"><Loader2 className="spin" />Preparing your 3D experience…</div></div> });
const ModelViewerModal = dynamic(() => import('./model-viewer-modal'), { ssr: false, loading: () => <div className="modal-overlay"><div className="loading-card"><Loader2 className="spin" />Preparing your 3D experience…</div></div> });

// Phase 4 viewer selection: a dish with a ready processed bundle gets
// the progressive viewer (poster -> low -> high, platform AR); anything
// else — no pipeline run yet, or the progressive viewer reporting a
// failure — gets the classic viewer, which also covers illustrative
// previews for dishes with no model at all.
export default function DishViewer({ product, currency = 'USD', onClose }: { product: Product; currency?: string; onClose: () => void }) {
  const [fellBack, setFellBack] = useState(false);
  const bundle = product.model3d;
  if (!fellBack && bundle && (bundle.low || bundle.high)) {
    return <ModelViewerModal product={product} currency={currency} onClose={onClose} onFallback={() => setFellBack(true)} />;
  }
  return <ProductViewer product={product} currency={currency} onClose={onClose} />;
}
