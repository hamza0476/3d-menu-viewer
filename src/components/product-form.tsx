'use client';
import { useRef, useState, useEffect } from 'react';
import { Upload, Camera, ImagePlus, Box, X, Loader2, Check, Info, Sparkles, Calculator } from 'lucide-react';
import { Modal, request, money } from './ui';
import { DISH_TAGS, DEALS_CATEGORY, type Product } from '@/lib/demo';

export default function ProductForm({ product, currency = 'USD', categories, allProducts, onClose, onSave }: { product: Partial<Product> | null; currency?: string; categories: string[]; allProducts: Product[]; onClose: () => void; onSave: (p: Product) => void }) {
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [price, setPrice] = useState(product?.price ? String(product.price / 100) : '');
  const [originalPrice, setOriginalPrice] = useState(product?.originalPrice ? String(product.originalPrice / 100) : '');
  const [category, setCategory] = useState(product?.category && product.category !== DEALS_CATEGORY ? product.category : (categories[0] || 'Main courses'));
  const [image, setImage] = useState(product?.image || '');
  const [photos, setPhotos] = useState<string[]>(product?.photos || []);
  const [tags, setTags] = useState<string[]>(product?.tags || []);
  const [model, setModel] = useState(product?.model || '');
  const [available, setAvailable] = useState(product?.available ?? true);
  const [isDeal, setIsDeal] = useState(product?.isDeal ?? false);
  const [dealItems, setDealItems] = useState<string[]>(product?.dealItems || []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);

  const toggleTag = (id: string) => setTags(v => v.includes(id) ? v.filter(t => t !== id) : [...v, id]);
  const bundleable = allProducts.filter(p => !p.isDeal && p.id !== product?.id);
  const toggleDealItem = (id: string) => setDealItems(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);
  const bundleTotal = bundleable.filter(p => dealItems.includes(p.id)).reduce((s, p) => s + p.price, 0);

  useEffect(() => () => { stream.current?.getTracks().forEach(t => t.stop()); }, []);
  async function upload(file: File, isModel = false) { setUploading(true); setError(''); try { const form = new FormData(); form.append('file', file); const res = await fetch('/api/assets', { method: 'POST', body: form }); const data = await res.json(); if (!res.ok) throw new Error(data.error); if (isModel) setModel(data.url); else { setPhotos(p => [...p, data.url].slice(0, 16)); setImage(prev => prev || data.url); } } catch (e) { setError((e as Error).message); } finally { setUploading(false); } }
  async function openCamera() { try { stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); setCamera(true); setTimeout(() => { if (video.current) { video.current.srcObject = stream.current; void video.current.play(); } }, 50); } catch { setError('Camera unavailable. Allow camera access in your browser, or upload photos instead.'); } }
  function closeCamera() { stream.current?.getTracks().forEach(t => t.stop()); setCamera(false); }
  function capture() { if (!video.current) return; const canvas = document.createElement('canvas'); canvas.width = video.current.videoWidth; canvas.height = video.current.videoHeight; canvas.getContext('2d')?.drawImage(video.current, 0, 0); canvas.toBlob(blob => { if (blob) void upload(new File([blob], 'capture.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', .93); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    if (isDeal && dealItems.length < 2) { setError('Select at least 2 items to bundle into this deal.'); setBusy(false); return; }
    try {
      const p = await request<Product>('/api/products', product?.id ? 'PATCH' : 'POST', { id: product?.id, name, description, price: Math.round(Number(price) * 100), originalPrice: originalPrice ? Math.round(Number(originalPrice) * 100) : null, category: isDeal ? DEALS_CATEGORY : category, image, photos, tags, model, available, isDeal, dealItems });
      onSave(p);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title={product?.id ? (product.isDeal ? 'Edit deal' : 'Edit menu item') : 'Something delicious starts here'} subtitle="Add the details. Make a great first impression." onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-body product-form-grid">
          <div>
            <label className="check-label" style={{ marginBottom: 4 }}><input type="checkbox" checked={isDeal} onChange={e => { setIsDeal(e.target.checked); setError(''); }} /> <Sparkles size={14} style={{ marginRight: 2 }} /> This is a Deal (bundle 2+ items)</label>
            <label>{isDeal ? 'Deal name' : 'Dish name'}<input required value={name} onChange={e => setName(e.target.value)} placeholder={isDeal ? 'e.g. Burger & dessert duo' : 'e.g. Avocado & grain bowl'} maxLength={120} /></label>
            <label>Description<textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Tell guests what makes it special…" rows={4} /></label>
            <div className="form-row">
              <label>{isDeal ? 'Deal price' : 'Price'} ({currency})<input type="number" min="0" max="10000" step="0.01" required value={price} onChange={e => setPrice(e.target.value)} placeholder="16.50" /></label>
              {isDeal ? <label>Category<input disabled value={DEALS_CATEGORY} /></label> : <label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>}
            </div>
            <label>Original price ({currency}) <span className="optional">Optional — shows strikethrough</span><input type="number" min="0" max="10000" step="0.01" value={originalPrice} onChange={e => setOriginalPrice(e.target.value)} placeholder="e.g. 22.00" /></label>
            {isDeal && bundleTotal > 0 && <button type="button" className="text-link" style={{ margin: '-10px 0 14px' }} onClick={() => setOriginalPrice(String(bundleTotal / 100))}><Calculator size={13} /> Use items' total as original price ({money(bundleTotal, currency)})</button>}
            <label className="check-label"><input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)} /> Available on the guest menu</label>
            {isDeal ? (
              <>
                <label>Items in this deal <span className="optional">{dealItems.length} selected · min. 2</span></label>
                <div className="deal-picker">
                  {bundleable.length ? bundleable.map(p => (
                    <label key={p.id} className={'deal-picker-row ' + (dealItems.includes(p.id) ? 'selected' : '')}>
                      <input type="checkbox" checked={dealItems.includes(p.id)} onChange={() => toggleDealItem(p.id)} />
                      <img src={p.image || '/images/menu-hero.jpg'} alt={p.name} />
                      <span><strong>{p.name}</strong><small>{p.category}</small></span>
                      <em>{money(p.price, currency)}</em>
                    </label>
                  )) : <p className="field-hint">Add a few regular menu items first, then come back to bundle them into a deal.</p>}
                </div>
              </>
            ) : (
              <>
                <label>Dietary &amp; allergens <span className="optional">Helps guests filter safely</span></label>
                <div className="category-tabs">{DISH_TAGS.filter(t => t.group === 'diet').map(t => <button type="button" key={t.id} className={tags.includes(t.id) ? 'selected' : ''} onClick={() => toggleTag(t.id)}>{t.label}</button>)}</div>
                <div className="category-tabs" style={{ marginTop: 8 }}>{DISH_TAGS.filter(t => t.group === 'allergen').map(t => <button type="button" key={t.id} className={tags.includes(t.id) ? 'selected' : ''} onClick={() => toggleTag(t.id)}>{t.label}</button>)}</div>
                <p className="field-hint">Dietary labels above, "contains" allergens below. Guests can filter these out on your public menu.</p>
              </>
            )}
            <div className="info-note"><Info size={18} /><p>{isDeal ? 'When a guest opens this deal, each included item opens its own real 3D preview, just like everywhere else on your menu.' : 'Photos are saved as a capture set. Photorealistic reconstruction requires an external photogrammetry service. Upload its GLB result below to enable your real 3D model.'}</p></div>
          </div>
          <div>
            <label>{isDeal ? 'Deal photo' : 'Product photos'} <span className="optional">{photos.length}/16 angles</span></label>
            <input hidden type="file" ref={photoInput} accept="image/jpeg,image/png,image/webp" multiple onChange={async e => { for (const f of Array.from(e.target.files || []).slice(0, 16 - photos.length)) await upload(f); }} />
            <div className="photo-upload" onClick={() => photoInput.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') photoInput.current?.click(); }}>{image ? <img src={image} alt="Product cover" /> : <><ImagePlus size={28} /><strong>Give your dish the spotlight</strong><span>Click to upload JPG, PNG or WebP</span></>}</div>
            <div className="capture-buttons"><button type="button" className="btn" disabled={uploading || photos.length >= 16} onClick={() => photoInput.current?.click()}>{uploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} Upload photos</button><button type="button" className="btn" onClick={openCamera}><Camera size={16} /> Open camera</button></div>
            {photos.length > 0 && <div className="photo-strip">{photos.map((p, i) => <div key={p + i}><img src={p} alt={'Angle ' + (i + 1)} onClick={() => setImage(p)} /><button type="button" aria-label="Remove photo" onClick={() => { setPhotos(v => v.filter((_, j) => j !== i)); if (image === p) setImage(photos.find(x => x !== p) || ''); }}><X size={10} /></button></div>)}</div>}
            <p className="field-hint">Capture 8–16 overlapping angles. Tap a photo to use it as the cover.</p>
            {!isDeal && (
              <>
                <input type="file" hidden ref={modelInput} accept=".glb" onChange={e => { if (e.target.files?.[0]) void upload(e.target.files[0], true); }} />
                <button type="button" className={'model-upload ' + (model ? 'has-model' : '')} disabled={uploading} onClick={() => modelInput.current?.click()}>{model ? <Check size={22} /> : <Box size={22} />}<span><strong>{model ? '3D model attached' : 'Upload a 3D model'}</strong><small>{model ? 'Click to replace your GLB model' : 'GLB format · up to 20 MB'}</small></span><Upload size={17} /></button>
                {model && <button className="text-link danger" type="button" onClick={() => setModel('')}>Remove 3D model</button>}
              </>
            )}
          </div>
        </div>
        {error && <div className="error-message">{error}</div>}
        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button disabled={busy || uploading} className="btn primary">{busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {busy ? 'Saving…' : product?.id ? 'Save changes' : isDeal ? 'Add deal' : 'Add menu item'}</button>
        </footer>
      </form>
      {camera && <div className="camera-overlay"><div className="camera-header"><span>Walk around your dish · {photos.length} angles captured</span><button type="button" className="icon-btn" onClick={closeCamera}><X /></button></div><video ref={video} playsInline muted autoPlay /><div className="camera-footer"><button type="button" disabled={uploading || photos.length >= 16} className="btn primary" onClick={capture}><Camera size={18} />{uploading ? 'Saving photo…' : 'Capture angle'}</button><button className="btn" onClick={closeCamera}>Done</button></div></div>}
    </Modal>
  );
}
