// HTTP + browser integration tests for Phase 5 (the Book Menu):
// book markup as the default guest experience (cover, spreads, thumb
// index), table context preserved, branding (logo/cover) through the
// Phase 2 published rule, per-restaurant PWA manifest, service worker,
// menu-payload ETag/SWR caching, the Phase 3 event pipeline still
// firing, and real Chromium checks (flip navigation, chapter jump, dish
// sheet, Urdu RTL toggle, list toggle + persistence, reduced-motion and
// stored-preference fallbacks, SW registration).
// Run via: bash tests/integration/run.sh book-menu.mjs
import pg from "pg";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const DB = process.env.PGDATABASE_URL;
if (!DB) { console.error("PGDATABASE_URL is required"); process.exit(2); }

let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failures++;
}

function cookieOf(res) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of cookies) { const m = c.match(/platera_session=([^;]+)/); if (m) return m[1]; }
  return null;
}
async function api(pathname, { method = "GET", body, cookie, raw, headers = {} } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), Origin: BASE, ...(cookie ? { Cookie: `platera_session=${cookie}` } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
    redirect: "manual",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { res, status: res.status, json, buf, text: buf.toString(), cookie: cookieOf(res), headers: res.headers, contentType: res.headers.get("content-type") || "" };
}
function pngFixture(width = 3, height = 5) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const chunk = Buffer.alloc(25);
  chunk.writeUInt32BE(13, 0); chunk.write("IHDR", 4, "latin1"); ihdr.copy(chunk, 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk]);
}
async function upload(cookie, buf, kind) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "image/png" }), "brand.png");
  if (kind) form.append("kind", kind);
  return api("/api/assets", { method: "POST", cookie, raw: form });
}

const pool = new pg.Pool({ connectionString: DB });
const stamp = Date.now();
const regA = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner A", email: `a-${stamp}@example.com`, password: `A-owner-${stamp}-pass!`, businessName: "Book Bistro" } });
const cookieA = regA.cookie;
check("owner A registers", regA.json?.ok === true && !!cookieA);
const wsA = await api("/api/workspace", { cookie: cookieA });
const business = wsA.json?.business;
const seeded = wsA.json?.products || [];
check("workspace loads with seeded menu (6 dishes + 1 sample deal)", !!business && seeded.length === 7);
const bid = business.id;

// Shape the book: Main courses grows to 7 dishes (2 spreads) + a deal.
for (let i = 1; i <= 4; i++) {
  const r = await api("/api/products", { method: "POST", cookie: cookieA, body: { name: `Book Dish M${i}`, description: `Main course number ${i} for the book`, price: 1500 + i, category: "Main courses", image: "", model: "", tags: ["spicy"], photos: [], available: true } });
  if (r.status !== 200 && r.status !== 201) { check(`extra main dish M${i} created`, false); }
}
check("4 extra main dishes created", (await api("/api/workspace", { cookie: cookieA })).json?.products?.length === 11);
const deal = await api("/api/products", { method: "POST", cookie: cookieA, body: { name: "Book Night Deal", description: "Two favourites bundled", price: 3900, category: "Main courses", image: "", model: "", tags: [], photos: [], available: true, isDeal: true, dealItems: [seeded[0].id, seeded[1].id] } });
check("deal created", (deal.status === 200 || deal.status === 201) && deal.json?.isDeal === true);

// --- Book markup is the default guest experience -------------------------------
const page = await api(`/menu/${bid}`);
check("menu page 200", page.status === 200);
console.log(`INFO menu HTML bytes: ${page.buf.length}`);
check("book is the server-rendered default (data-book-mode=book)", page.text.includes('data-book-mode="book"'));
check("cover sheet present with restaurant name + tap-to-open", page.text.includes("data-book-cover") && page.text.includes("Book Bistro") && page.text.includes("Tap to open"));
check("spreads server-rendered (stacked fallback carries every dish)", page.text.includes('data-spread-index="0"') && page.text.includes("Book Dish M4") && page.text.includes("Book Night Deal"));
check("chapter thumb index lists categories + Deals", page.text.includes("book-tab") && page.text.includes("Starters") && page.text.includes("Desserts") && page.text.includes("Deals"));
check("view toggle + language toggle present", page.text.includes("Book view") && page.text.includes("List view") && page.text.includes("اردو"));
check("manifest link in page head", page.text.includes(`/menu/${bid}/manifest.webmanifest`));
check("SEO/OG preserved", page.text.includes("<title>Book Bistro · Digital Menu</title>") && page.text.includes('property="og:title"'));

// --- Table context (Phase 3) still lands on the book ---------------------------
const t7 = await api("/api/tables", { method: "POST", cookie: cookieA, body: { label: "Table 7", seats: 4 } });
check("table created with QR", t7.status === 201 && !!t7.json?.qr?.code);
const pageT = await api(`/menu/${bid}?t=${t7.json.qr.code}`);
check("table banner shows on the book", pageT.text.includes("You&apos;re at") || pageT.text.includes("You're at") || pageT.text.includes("You&#x27;re at"));
check("table banner names the table", pageT.text.includes("Table 7"));

// --- Branding: logo/cover through the Phase 2 published rule -------------------
const logoUp = await upload(cookieA, pngFixture(8, 8), "logo");
check("logo upload accepted as kind logo", logoUp.status === 200 && logoUp.json?.kind === "logo");
const logoId = logoUp.json?.id;
const coverUp = await upload(cookieA, pngFixture(16, 9), "cover");
check("cover upload accepted as kind cover", coverUp.status === 200 && coverUp.json?.kind === "cover");
const coverId = coverUp.json?.id;
const logoAnon = await api(`/api/assets/${logoId}`);
check("logo is public while published (book cover needs it)", logoAnon.status === 200 && (logoAnon.headers.get("cache-control") || "").includes("immutable"));
const pageBranded = await api(`/menu/${bid}`);
check("cover page references the uploaded cover + logo assets", pageBranded.text.includes(`/api/assets/${coverId}`) && pageBranded.text.includes(`/api/assets/${logoId}`));

// --- PWA manifest ---------------------------------------------------------------
const manifest = await api(`/menu/${bid}/manifest.webmanifest`);
check("manifest 200 + manifest content type", manifest.status === 200 && manifest.contentType.includes("manifest"));
check("manifest carries restaurant identity + scope", manifest.json?.name?.includes("Book Bistro") && manifest.json?.start_url === `/menu/${bid}` && manifest.json?.display === "standalone");
check("manifest icon is the uploaded logo", Array.isArray(manifest.json?.icons) && manifest.json.icons[0]?.src === `/api/assets/${logoId}`);

// --- Service worker file ----------------------------------------------------------
const sw = await api("/sw.js");
check("service worker served, versioned, SWR inside", sw.status === 200 && sw.text.includes("platera-sw-v1") && sw.text.includes("staleWhileRevalidate"));
check("service worker revalidates (must-revalidate header)", (sw.headers.get("cache-control") || "").includes("must-revalidate"));

// --- Menu payload caching -----------------------------------------------------------
const payload1 = await api(`/api/menu/${bid}`);
check("payload 200 with branding + products", payload1.status === 200 && payload1.json?.branding?.logo === `/api/assets/${logoId}` && payload1.json?.products?.length === 12);
console.log(`INFO menu payload bytes: ${payload1.buf.length}`);
const cc = payload1.headers.get("cache-control") || "";
check("payload has SWR cache headers", cc.includes("s-maxage=60") && cc.includes("stale-while-revalidate=300"));
const etag = payload1.headers.get("etag") || "";
check("payload ETag is a quoted sha256", /^"[0-9a-f]{64}"$/.test(etag));
const payload304 = await api(`/api/menu/${bid}`, { headers: { "If-None-Match": etag } });
check("If-None-Match answers 304 with no body", payload304.status === 304 && payload304.buf.length === 0);

// --- Events still fire (Phase 3 pipeline semantics) ----------------------------------
const evSession = `book-suite-${stamp}`;
const evOpen = await api(`/api/menu/${bid}`, { method: "POST", body: { sessionId: evSession } });
check("menu_open event accepted", evOpen.status === 200 && evOpen.json?.ok === true);
const dishId = seeded[0].id;
const viewsBefore = (await pool.query("SELECT views FROM products WHERE id = $1", [dishId])).rows[0].views;
const evView = await api(`/api/menu/${bid}`, { method: "POST", body: { sessionId: evSession, productId: dishId } });
check("item_view event accepted", evView.status === 200 && evView.json?.ok === true);
const ev3d = await api(`/api/menu/${bid}`, { method: "POST", body: { sessionId: evSession, productId: dishId, type: "3d_open" } });
check("3d_open event accepted", ev3d.status === 200 && ev3d.json?.ok === true);
const viewsAfter = (await pool.query("SELECT views FROM products WHERE id = $1", [dishId])).rows[0].views;
check("item_view counted once, 3d_open did not inflate views", viewsAfter === viewsBefore + 1);
const evCounts = await pool.query("SELECT type, COUNT(*)::int AS n FROM guest_events WHERE business_id = $1 GROUP BY type", [bid]);
const byType = Object.fromEntries(evCounts.rows.map(r => [r.type, r.n]));
check("all three event types recorded", (byType.menu_open || 0) >= 1 && (byType.item_view || 0) >= 1 && (byType["3d_open"] || 0) >= 1);

// --- Unpublish revokes branding + manifest + payload -----------------------------------
const unpub = await api("/api/workspace", { method: "PATCH", cookie: cookieA, body: { name: business.name, published: false } });
check("owner unpublishes", unpub.json?.published === false);
check("logo stops being public when unpublished", (await api(`/api/assets/${logoId}`)).status === 404);
check("manifest 404 when unpublished", (await api(`/menu/${bid}/manifest.webmanifest`)).status === 404);
const payloadGone = await api(`/api/menu/${bid}`);
check("payload 404 + no-store when unpublished", payloadGone.status === 404 && (payloadGone.headers.get("cache-control") || "").includes("no-store"));
// Publishing requires a verified email (Phase 1 rule) — mark the owner
// verified directly, mirroring the real verify flow, then republish.
await pool.query("UPDATE users SET email_verified = true WHERE email = $1", [`a-${stamp}@example.com`]);
const repub = await api("/api/workspace", { method: "PATCH", cookie: cookieA, body: { name: business.name, published: true } });
check("owner republishes (verified email)", repub.json?.published === true);
check("logo public again after republish", (await api(`/api/assets/${logoId}`)).status === 200);

// --- Browser checks (real Chromium) -------------------------------------------------------
let browser = null;
try {
  browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
} catch (e) {
  check("chromium launches for browser checks: " + e.message, false);
}
if (browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const pg = await ctx.newPage();
  await pg.goto(`${BASE}/menu/${bid}`, { waitUntil: "networkidle" });
  check("browser: animated book stage mounts", await pg.locator(".book-stage.book-anim").count() === 1);
  check("browser: cover is the first sheet", await pg.locator("[data-book-cover]").isVisible());
  await pg.getByRole("button", { name: "Tap to open" }).click();
  await pg.waitForFunction(() => document.querySelector(".book-stage")?.getAttribute("data-page") === "1", null, { timeout: 5000 }).catch(() => {});
  check("browser: tap-to-open turns to the first spread (Deals chapter)", (await pg.locator(".book-stage").getAttribute("data-page")) === "1" && (await pg.locator(".book-stage").getAttribute("data-chapter")) === "Deals");
  await pg.getByRole("button", { name: "Next page" }).click();
  await pg.waitForFunction(() => document.querySelector(".book-stage")?.getAttribute("data-page") === "2", null, { timeout: 5000 }).catch(() => {});
  check("browser: next-page control advances", (await pg.locator(".book-stage").getAttribute("data-page")) === "2");
  await pg.locator(".book-tab", { hasText: "Desserts" }).first().click();
  await pg.waitForFunction(() => document.querySelector(".book-stage")?.getAttribute("data-chapter") === "Desserts", null, { timeout: 5000 }).catch(() => {});
  check("browser: thumb index jumps to the Desserts chapter", (await pg.locator(".book-stage").getAttribute("data-chapter")) === "Desserts");

  // Dish sheet from a book card (Starters chapter, its only dish).
  const starterDish = seeded.find(p => p.category === "Starters") || seeded[0];
  await pg.locator(".book-tab", { hasText: "Starters" }).first().click();
  await pg.waitForFunction(() => document.querySelector(".book-stage")?.getAttribute("data-chapter") === "Starters", null, { timeout: 5000 }).catch(() => {});
  const viewsB = (await pool.query("SELECT views FROM products WHERE id = $1", [starterDish.id])).rows[0].views;
  await pg.locator("[data-dish-id]").first().click();
  await pg.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  check("browser: dish tap opens the detail sheet", await pg.locator('[role="dialog"]').isVisible());
  check("browser: sheet shows the 3D entry (illustrative label, no model)", (await pg.locator('[role="dialog"]').innerText()).includes("Illustrative 3D preview"));
  await pg.waitForTimeout(600);
  const viewsA2 = (await pool.query("SELECT views FROM products WHERE id = $1", [starterDish.id])).rows[0].views;
  check("browser: sheet open fired item_view through the real UI", viewsA2 === viewsB + 1);
  await pg.getByRole("button", { name: "Close dialog" }).click();

  // Urdu toggle -> RTL chrome.
  await pg.getByRole("button", { name: "Switch language" }).click();
  await pg.waitForTimeout(300);
  check("browser: Urdu toggle flips the book to RTL", (await pg.locator(".book-wrap").getAttribute("dir")) === "rtl");
  check("browser: Urdu chrome strings render", await pg.locator('[aria-label="اگلا صفحہ"]').count() === 1);
  await pg.getByRole("button", { name: "Switch language" }).click();

  // Service worker registration.
  await pg.waitForTimeout(1200);
  const swRegistered = await pg.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg;
  }).catch(() => false);
  check("browser: service worker registers from the menu page", swRegistered === true);

  // List toggle + persistence.
  await pg.getByRole("button", { name: "List view" }).click();
  await pg.waitForSelector(".guest-products", { timeout: 5000 }).catch(() => {});
  check("browser: list toggle shows the classic grid", await pg.locator(".guest-products").isVisible());
  const storedView = await pg.evaluate((id) => localStorage.getItem("platera-view-" + id), bid);
  check("browser: list choice persists to localStorage", storedView === "list");
  await pg.reload({ waitUntil: "networkidle" });
  check("browser: list survives reload (stored choice wins)", await pg.locator(".guest-products").isVisible());
  await ctx.close();

  // Reduced motion -> automatic list fallback.
  const ctxRM = await browser.newContext({ viewport: { width: 420, height: 860 }, reducedMotion: "reduce" });
  const pgRM = await ctxRM.newPage();
  await pgRM.goto(`${BASE}/menu/${bid}`, { waitUntil: "networkidle" });
  await pgRM.waitForTimeout(800);
  check("browser: reduced-motion guests get the list automatically", await pgRM.locator(".guest-products").isVisible() && (await pgRM.locator(".book-stage.book-anim").count()) === 0);
  await ctxRM.close();

  // Stored book choice under reduced motion -> non-animated book, not list.
  const ctxSB = await browser.newContext({ viewport: { width: 420, height: 860 }, reducedMotion: "reduce" });
  await ctxSB.addInitScript((id) => { try { localStorage.setItem("platera-view-" + id, "book"); } catch {} }, bid);
  const pgSB = await ctxSB.newPage();
  await pgSB.goto(`${BASE}/menu/${bid}`, { waitUntil: "networkidle" });
  await pgSB.waitForTimeout(800);
  check("browser: stored book + reduced motion = static book", (await pgSB.locator(".book-stage.book-static").count()) === 1 && (await pgSB.locator(".guest-products").count()) === 0);
  await ctxSB.close();

  await browser.close();
}

await pool.end();
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
