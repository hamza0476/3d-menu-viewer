// Poster renderer for the Phase 4 model pipeline.
//
//   node scripts/render-poster.mjs <input.glb> <output.png>
//
// Renders a 3/4-angle poster of a GLB in headless Chromium (Playwright)
// using the repo's own three.js — the same lighting recipe as the guest
// viewer, on the viewer's stage colour. Page, model and three.js are
// served from a throwaway localhost HTTP server inside this script,
// because Chromium will not load ES modules from file:// URLs.
//
// The pipeline runs it only when the operator configures
// MODEL_POSTER_CMD, e.g.:
//   MODEL_POSTER_CMD="node scripts/render-poster.mjs {in} {out}"
// which requires the browser binaries once:
//   npx playwright install chromium
// Without that setup the pipeline records posterStatus='not-configured'
// — this script is never invoked implicitly, and no poster is faked.
//
// Exits non-zero with a reason on stderr for: missing browser, unreadable
// or invalid GLB, WebGL unavailable, or a blank render.

import { chromium } from "@playwright/test";
import { createReadStream, promises as fs } from "fs";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: render-poster.mjs <input.glb> <output.png>");
  process.exit(2);
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const threeRoot = path.join(repoRoot, "node_modules", "three");

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<style>html,body{margin:0;background:#f4f3ea}canvas{display:block}</style></head>
<body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
window.__done = false; window.__error = '';
try {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(640, 640);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xf4f3ea, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  camera.position.set(4, 4.5, 5);
  camera.lookAt(0, 0.55, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb1a694, 3));
  const light = new THREE.DirectionalLight(0xfff6e9, 4);
  light.position.set(3, 6, 4); light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
  scene.add(light);
  const fill = new THREE.DirectionalLight(0xffffff, 1.4); fill.position.set(-4, 2, -2); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.13 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.1; floor.receiveShadow = true; scene.add(floor);
  const gltf = await new GLTFLoader().loadAsync('/model.glb');
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const factor = 3 / Math.max(size.x, size.y, size.z);
  gltf.scene.position.sub(center);
  const normalizer = new THREE.Group();
  normalizer.add(gltf.scene);
  normalizer.scale.setScalar(factor);
  normalizer.position.y = size.y * factor / 2;
  normalizer.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(normalizer);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__done = true;
} catch (e) { window.__error = String(e && e.message || e); }
</script></body></html>`;

const modelBytes = await fs.readFile(path.resolve(input)).catch((e) => {
  console.error(`cannot read input GLB: ${e.message}`);
  process.exit(2);
});

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PAGE);
    return;
  }
  if (url.pathname === "/model.glb") {
    res.writeHead(200, { "Content-Type": "model/gltf-binary" });
    res.end(modelBytes);
    return;
  }
  if (url.pathname.startsWith("/three/")) {
    const rel = url.pathname.slice("/three/".length);
    const file = path.join(threeRoot, rel);
    if (!file.startsWith(threeRoot + path.sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/javascript" });
    createReadStream(file).on("error", () => { if (!res.headersSent) res.writeHead(404); res.end(); }).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

let browser;
try {
  browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
} catch (e) {
  console.error(`headless Chromium unavailable (run: npx playwright install chromium): ${e.message}`);
  process.exit(3);
}
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__done || window.__error, null, { timeout: 60_000 });
  const error = await page.evaluate(() => window.__error);
  if (error) { console.error(`render failed: ${error}`); process.exit(4); }
  const canvas = await page.$("canvas");
  if (!canvas) { console.error("render failed: no canvas"); process.exit(4); }
  const png = await canvas.screenshot({ type: "png" });
  if (png.length < 3000) { console.error(`render failed: suspiciously small PNG (${png.length} bytes)`); process.exit(4); }
  await fs.writeFile(path.resolve(output), png);
  console.log(`poster rendered: ${png.length} bytes`);
} finally {
  await browser.close().catch(() => {});
  server.close();
}
