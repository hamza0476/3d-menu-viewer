'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box, Info, Loader2, RotateCw, Sparkles, View, ZoomIn } from 'lucide-react';
import { Modal, money } from './ui';
import { dishTagLabel, type Product } from '@/lib/demo';

// Progressive 3D viewer for dishes whose Phase 4 pipeline run is ready —
// the <model-viewer> loading semantics, implemented on the repo's existing
// Three.js stack (@google/model-viewer cannot be used: every published
// version peer-pins an older three than this repo runs — DECISIONS.md):
//
//   1. the poster (or dish photo) paints immediately — no blank stage;
//   2. the LOW variant loads and becomes interactive;
//   3. the HIGH variant preloads in the background and swaps in when
//      ready — skipped automatically on slow / data-saver connections,
//      where a "High quality" button offers it explicitly instead;
//   4. AR where the platform truly supports it: iOS Quick Look via a
//      rel="ar" USDZ anchor, Android WebXR via an immersive-ar session
//      on this same renderer. Where neither exists there is no AR
//      button at all — no fake affordances.
//
// Any failure (WebGL missing, model fetch/parse error) calls onFallback,
// and the caller swaps in the classic viewer — the guest is never left
// with a dead stage.

type NavigatorXr = {
  xr?: {
    isSessionSupported?: (mode: string) => Promise<boolean>;
    requestSession: (mode: string, init?: unknown) => Promise<unknown>;
  };
  connection?: { saveData?: boolean; effectiveType?: string };
};

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export default function ModelViewerModal({ product, currency = 'USD', onClose, onFallback }: {
  product: Product;
  currency?: string;
  onClose: () => void;
  onFallback: () => void;
}) {
  const bundle = product.model3d!;
  const host = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const upgradeRef = useRef<(() => void) | null>(null);
  const xrStartRef = useRef<(() => Promise<void>) | null>(null);
  const [loading, setLoading] = useState(true);
  const [hd, setHd] = useState(false);
  const [hdOffered, setHdOffered] = useState(false);
  const [rotating, setRotating] = useState(true);
  const [scale, setScale] = useState(1);
  const [webxr, setWebxr] = useState(false);
  const [xrError, setXrError] = useState('');

  const poster = bundle.poster || product.image;
  const quickLook = Boolean(bundle.usdz) && isIos();

  useEffect(() => {
    const nav = navigator as unknown as NavigatorXr;
    if (nav.xr?.isSessionSupported) {
      nav.xr.isSessionSupported('immersive-ar').then(setWebxr).catch(() => setWebxr(false));
    }
  }, []);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      onFallback();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    host.current.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    camera.position.set(4, 4.5, 5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.55, 0);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controls.minDistance = 3;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.48;
    controlsRef.current = controls;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb1a694, 3));
    const light = new THREE.DirectionalLight(0xfff6e9, 4);
    light.position.set(3, 6, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    scene.add(light);
    const fill = new THREE.DirectionalLight(0xffffff, 1.4);
    fill.position.set(-4, 2, -2);
    scene.add(fill);
    const group = new THREE.Group();
    groupRef.current = group;
    scene.add(group);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.13 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    scene.add(floor);

    let current: THREE.Group | null = null;
    function showModel(sceneGraph: THREE.Object3D) {
      const box = new THREE.Box3().setFromObject(sceneGraph);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const factor = 3 / Math.max(size.x, size.y, size.z);
      sceneGraph.position.sub(center);
      const normalizer = new THREE.Group();
      normalizer.add(sceneGraph);
      normalizer.scale.setScalar(factor);
      normalizer.position.y = (size.y * factor) / 2;
      normalizer.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      if (current) { group.remove(current); }
      current = normalizer;
      group.add(normalizer);
    }

    const firstUrl = bundle.low || bundle.high || product.model;
    const highUrl = bundle.high && bundle.high !== firstUrl ? bundle.high : null;
    let hdLoaded = false;
    function loadHigh() {
      if (!highUrl || hdLoaded || disposed) return;
      hdLoaded = true;
      new GLTFLoader().load(highUrl, (gltf) => { if (disposed) return; showModel(gltf.scene); setHd(true); setHdOffered(false); }, undefined, () => { /* keep the low variant — it is already on stage */ });
    }
    upgradeRef.current = loadHigh;

    if (!firstUrl) { onFallback(); return; }
    new GLTFLoader().load(firstUrl, (gltf) => {
      if (disposed) return;
      showModel(gltf.scene);
      setLoading(false);
      if (highUrl) {
        const conn = (navigator as unknown as NavigatorXr).connection;
        const slow = Boolean(conn?.saveData) || ['slow-2g', '2g', '3g'].includes(conn?.effectiveType ?? '');
        if (slow) setHdOffered(true);
        else loadHigh();
      }
    }, undefined, () => { if (!disposed) onFallback(); });

    xrStartRef.current = async () => {
      const nav = navigator as unknown as NavigatorXr;
      if (!nav.xr) return;
      try {
        setXrError('');
        let session: unknown;
        let viewerSpace = false;
        try {
          session = await nav.xr.requestSession('immersive-ar', { optionalFeatures: ['local-floor', 'hit-test'] });
        } catch {
          session = await nav.xr.requestSession('immersive-ar', { requiredFeatures: ['viewer'] });
          viewerSpace = true;
        }
        if (viewerSpace) group.position.set(0, -0.3, -1.2);
        (session as { addEventListener: (t: string, f: () => void) => void }).addEventListener('end', () => { group.position.set(0, 0, 0); });
        controls.enabled = false;
        await renderer.xr.setSession(session as never);
        (session as { addEventListener: (t: string, f: () => void) => void }).addEventListener('end', () => { controls.enabled = true; });
      } catch {
        setXrError('AR could not start on this device. You can still explore the model here.');
      }
    };

    const resize = () => {
      if (!host.current) return;
      const { width, height } = host.current.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    return () => {
      disposed = true;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose(); m.dispose(); });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  return (
    <Modal title={product.name} subtitle="Get a taste of a new perspective." onClose={onClose} wide>
      <div className="viewer-stage">
        {/* eslint-disable-next-line @next/next/no-img-element -- poster must paint instantly, unoptimised (same call as qr-kit/print) */}
        {poster && <img className="viewer-poster" src={poster} alt={product.name} />}
        <div className="viewer-canvas" ref={host} />
        <span className="viewer-badge"><Box size={14} />{hd ? 'Interactive 3D model · high quality' : 'Interactive 3D model'}</span>
        {loading && <div className="viewer-loading"><Loader2 className="spin" /> Preparing your preview…</div>}
        <div className="viewer-hint">Drag to rotate · scroll to zoom</div>
      </div>
      <div className="viewer-controls">
        {quickLook && bundle.usdz && (
          <a className="btn primary" rel="ar" href={bundle.usdz}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Quick Look requires an <img> inside the rel="ar" anchor */}
            <img src={poster || ''} alt="" style={{ display: 'none' }} />
            <View size={16} /> View in your space
          </a>
        )}
        {webxr && <button className="btn primary" onClick={() => void xrStartRef.current?.()}><View size={16} /> View in your space</button>}
        <button className="btn" onClick={() => { setRotating(!rotating); if (controlsRef.current) controlsRef.current.autoRotate = !rotating; }}><RotateCw size={16} />{rotating ? 'Pause rotation' : 'Auto rotate'}</button>
        {hdOffered && <button className="btn" onClick={() => upgradeRef.current?.()}><Sparkles size={16} /> High quality</button>}
        <label className="scale-control"><ZoomIn size={17} /><input aria-label="Model size" type="range" min=".4" max="1.7" step=".05" value={scale} onChange={(e) => { const n = Number(e.target.value); setScale(n); groupRef.current?.scale.setScalar(n); }} /></label>
      </div>
      {xrError && <div className="error-message">{xrError}</div>}
      <div className="viewer-details">
        <div>
          <span className="eyebrow">{product.category}</span>
          <p>{product.description}</p>
          {product.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>{product.tags.map((t) => <span key={t} className="status-pill">{dishTagLabel(t)}</span>)}</div>}
        </div>
        <div className="price-row">{product.originalPrice ? <span className="was">{money(product.originalPrice, currency)}</span> : null}<strong>{money(product.price, currency)}</strong></div>
      </div>
      <div className="viewer-disclaimer"><Info size={15} />Explore the restaurant’s uploaded 3D model — shown first as a poster, then the light model, upgrading to full detail when your connection allows. Appearance and portions may vary.</div>
    </Modal>
  );
}
