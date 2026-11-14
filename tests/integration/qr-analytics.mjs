// HTTP-level integration tests for Phase 3 (QR, tables & analytics):
// table/QR management + tenant isolation, server-side QR rendering verified
// by actually DECODING the PNG (jsQR), the /m/<code> resolver + scan events,
// table context on the guest menu, the S12 spam controls (per-session
// de-duplication + per-connection rate limit), the nightly rollup
// (idempotent), and the dashboard analytics API + CSV export.
// Run via: bash tests/integration/run.sh qr-analytics.mjs
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import pg from "pg";
import { PNG } from "pngjs";
import jsQR from "jsqr";

const run = promisify(execFile);
const BASE = process.env.BASE || "http://127.0.0.1:3100";
const DB = process.env.PGDATABASE_URL;
if (!DB) { console.error("PGDATABASE_URL is required"); process.exit(2); }

let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failures++;
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const todayUtc = new Date().toISOString().slice(0, 10);

function cookieOf(res) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of cookies) { const m = c.match(/platera_session=([^;]+)/); if (m) return m[1]; }
  return null;
}
async function api(pathname, { method = "GET", body, cookie, ua } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), Origin: BASE, ...(cookie ? { Cookie: `platera_session=${cookie}` } : {}), ...(ua ? { "User-Agent": ua } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { res, status: res.status, json, buf, text: buf.toString(), cookie: cookieOf(res), location: res.headers.get("location"), contentType: res.headers.get("content-type") || "" };
}

const pool = new pg.Pool({ connectionString: DB });
const stamp = Date.now();
const regA = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner A", email: `a-${stamp}@example.com`, password: `A-owner-${stamp}-pass!`, businessName: "A's Place" } });
const cookieA = regA.cookie;
check("owner A registers", regA.json?.ok === true && !!cookieA);
const regB = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner B", email: `b-${stamp}@example.com`, password: `B-owner-${stamp}-pass!`, businessName: "B's Place" } });
const cookieB = regB.cookie;
check("owner B registers", regB.json?.ok === true && !!cookieB);

const wsA = await api("/api/workspace", { cookie: cookieA });
const businessA = wsA.json?.business?.id;
const productA = wsA.json?.products?.[0]?.id;
check("A workspace loads (business + seeded product)", !!businessA && !!productA);
const wsB = await api("/api/workspace", { cookie: cookieB });
const businessB = wsB.json?.business?.id;
const productB = wsB.json?.products?.[0]?.id;
check("B workspace loads", !!businessB && !!productB);
const viewsOf = async (pid) => (await pool.query("SELECT views FROM products WHERE id = $1", [pid])).rows[0].views;
const productAViews0 = await viewsOf(productA);
const productBViews0 = await viewsOf(productB);

// --- P3-2: tables & master QR ---------------------------------------------------
const anonTables = await api("/api/tables");
check("unauthenticated tables list -> 401", anonTables.status === 401);

const listA1 = await api("/api/tables", { cookie: cookieA });
check("A's list auto-creates a master QR (12-char code, no table)", listA1.status === 200 && !!listA1.json?.master && listA1.json.master.tableId === null && /^[a-z2-9]{12}$/.test(listA1.json.master.code) && Array.isArray(listA1.json.tables) && listA1.json.tables.length === 0);
const masterA = listA1.json.master;

const badTable = await api("/api/tables", { method: "POST", cookie: cookieA, body: { seats: 4 } });
check("table without a label -> 400", badTable.status === 400);

const t5 = await api("/api/tables", { method: "POST", cookie: cookieA, body: { label: "Table 5", seats: 4 } });
check("A creates Table 5 with its own QR", t5.status === 201 && !!t5.json?.qr && t5.json.qr.tableId === t5.json.id && t5.json.qr.label === "Table 5" && t5.json.seats === 4);
const table5 = t5.json;

const listB = await api("/api/tables", { cookie: cookieB });
check("B sees none of A's tables; B's master code differs", listB.json?.tables?.length === 0 && listB.json?.master?.code !== masterA.code);
const masterB = listB.json.master;

const patchForeign = await api(`/api/tables/${table5.id}`, { method: "PATCH", cookie: cookieB, body: { label: "Hijacked" } });
check("B cannot rename A's table (404)", patchForeign.status === 404);
const deleteForeign = await api(`/api/tables/${table5.id}`, { method: "DELETE", cookie: cookieB });
check("B cannot delete A's table (404)", deleteForeign.status === 404);

const renamed = await api(`/api/tables/${table5.id}`, { method: "PATCH", cookie: cookieA, body: { label: "Table Five" } });
check("A renames the table; the QR label follows", renamed.status === 200 && renamed.json?.label === "Table Five" && renamed.json?.qr?.label === "Table Five");

// --- P3-2: server-side QR rendering, verified by decoding -----------------------
const imgAnon = await api(`/api/qr/${table5.qr.id}/image`);
check("QR image without a session -> 401", imgAnon.status === 401);
const imgForeign = await api(`/api/qr/${table5.qr.id}/image`, { cookie: cookieB });
check("QR image for B -> 404", imgForeign.status === 404);
const img = await api(`/api/qr/${table5.qr.id}/image`, { cookie: cookieA });
check("QR PNG renders (200, png content type, PNG magic)", img.status === 200 && img.contentType.includes("image/png") && img.buf[0] === 0x89 && img.buf[1] === 0x50);
let decoded = null;
try {
  const png = PNG.sync.read(img.buf);
  const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  decoded = qr?.data || null;
} catch {}
check("QR PNG decodes to the resolver URL /m/<code>", decoded === `${BASE}/m/${table5.qr.code}`);
const svg = await api(`/api/qr/${table5.qr.id}/image?format=svg`, { cookie: cookieA });
check("QR SVG renders", svg.status === 200 && svg.contentType.includes("image/svg+xml") && svg.text.includes("<svg"));

const assetRow = (await pool.query("SELECT kind, sha256, bytes, storage_key FROM assets WHERE storage_key = $1", [`assets/${(await pool.query("SELECT owner_id FROM businesses WHERE id = $1", [businessA])).rows[0].owner_id}/qr-${table5.qr.id}.png`])).rows[0];
check("print PNG stored as a qr-print asset with matching sha256", !!assetRow && assetRow.kind === "qr-print" && assetRow.sha256 === createHash("sha256").update(img.buf).digest("hex") && assetRow.bytes === img.buf.length);

const printPage = await api(`/print/qr/${table5.qr.id}?layout=tent`, { cookie: cookieA });
check("print kit (tent) renders for the owner with name + table", printPage.status === 200 && printPage.text.includes("A&#x27;s Place") || (printPage.status === 200 && printPage.text.includes("Table Five")));
const printForeign = await api(`/print/qr/${table5.qr.id}?layout=sticker`, { cookie: cookieB });
// The not-found UI streams with a 200 under the root loading boundary
// (same framework behaviour as /menu/<id>), so assert on CONTENT: B must
// get the 404 page and none of A's card data or QR image URL.
check("print kit for B -> not-found page, no card data leaked", printForeign.text.includes("isn't on the menu") && !printForeign.text.includes(`/api/qr/${table5.qr.id}/image`) && !printForeign.text.includes("Table Five"));

// Regeneration: old code dies, new code lives.
const regen = await api(`/api/qr/${table5.qr.id}`, { method: "POST", cookie: cookieA });
check("A regenerates the table QR code", regen.status === 200 && regen.json?.code && regen.json.code !== table5.qr.code);
const oldResolve = await api(`/m/${table5.qr.code}`);
check("old code no longer resolves (404)", oldResolve.status === 404);
table5.qr = regen.json;

// --- P3-3: resolver + scan events + table context --------------------------------
const t7 = await api("/api/tables", { method: "POST", cookie: cookieA, body: { label: "Table 7", seats: 2 } });
const table7 = t7.json;
const code7 = table7.qr.code;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const resolve = await api(`/m/${code7}`, { ua: IPHONE });
check("resolver redirects 302 to the menu with table context", resolve.status === 302 && (resolve.location || "").endsWith(`/menu/${businessA}?t=${code7}`));
const scanRow = (await pool.query("SELECT * FROM guest_events WHERE business_id = $1 AND type = 'scan'", [businessA])).rows[0];
check("scan event recorded with qr + table attribution and mobile device class", !!scanRow && scanRow.qr_code_id === table7.qr.id && scanRow.table_id === table7.id && scanRow.device_class === "mobile");

const unknownResolve = await api("/m/zzzzzzzzzzzz");
check("well-shaped but unknown code -> 404", unknownResolve.status === 404);
const badShape = await api("/m/not-a-code!!");
check("malformed code -> 404", badShape.status === 404);

const menuWithTable = await api(`/menu/${businessA}?t=${code7}`);
check("guest menu shows the table header for a table scan", menuWithTable.status === 200 && menuWithTable.text.includes("You&#x27;re at") && menuWithTable.text.includes("Table 7"));
const menuPlain = await api(`/menu/${businessA}`);
check("guest menu without a code shows no table header", menuPlain.status === 200 && !menuPlain.text.includes("You&#x27;re at"));

// --- P3-3: event pipeline (menu_open / item_view, dedupe, attribution) ------------
const open1 = await api(`/api/menu/${businessA}`, { method: "POST", body: { qrCode: code7, sessionId: "sess-alpha-123" } });
check("menu_open accepted", open1.status === 200 && open1.json?.ok === true);
const openRow = (await pool.query("SELECT * FROM guest_events WHERE business_id = $1 AND type = 'menu_open'", [businessA])).rows[0];
check("menu_open stored with table attribution; session id stored HASHED", !!openRow && openRow.table_id === table7.id && openRow.session_anon_id === sha256("sess-alpha-123") && openRow.session_anon_id !== "sess-alpha-123");
const open2 = await api(`/api/menu/${businessA}`, { method: "POST", body: { qrCode: code7, sessionId: "sess-alpha-123" } });
check("same session re-open inside 60s is deduped", open2.json?.deduped === true);
const openCount = (await pool.query("SELECT count(*)::int c FROM guest_events WHERE business_id = $1 AND type = 'menu_open'", [businessA])).rows[0].c;
check("dedupe kept the menu_open count at 1", openCount === 1);

const view1 = await api(`/api/menu/${businessA}`, { method: "POST", body: { productId: productA, qrCode: code7, sessionId: "sess-alpha-123" } });
check("item_view accepted; views counter +1", view1.status === 200 && (await viewsOf(productA)) === productAViews0 + 1);
const view2 = await api(`/api/menu/${businessA}`, { method: "POST", body: { productId: productA, qrCode: code7, sessionId: "sess-alpha-123" } });
check("same session + same dish inside 60s deduped; counter unchanged", view2.json?.deduped === true && (await viewsOf(productA)) === productAViews0 + 1);
const view3 = await api(`/api/menu/${businessA}`, { method: "POST", body: { productId: productA, qrCode: code7, sessionId: "sess-beta-456" } });
check("a different session counts again (+1)", view3.status === 200 && (await viewsOf(productA)) === productAViews0 + 2);
const viewForeign = await api(`/api/menu/${businessA}`, { method: "POST", body: { productId: productA, qrCode: masterB.code, sessionId: "sess-gamma-789" } });
const foreignRow = (await pool.query("SELECT * FROM guest_events WHERE business_id = $1 AND type = 'item_view' AND session_anon_id = $2", [businessA, sha256("sess-gamma-789")])).rows[0];
check("a foreign restaurant's QR code is ignored (event counts, no attribution)", viewForeign.status === 200 && !!foreignRow && foreignRow.qr_code_id === null && foreignRow.table_id === null);

// --- P3-3: S12 rate limit burst (fresh bucket: business B) -------------------------
let okCount = 0, limited = 0;
for (let i = 0; i < 125; i++) {
  const r = await api(`/api/menu/${businessB}`, { method: "POST", body: { productId: productB, sessionId: `burst-${i}-session` } });
  if (r.status === 200) okCount++;
  else if (r.status === 429) limited++;
}
check("burst: exactly the 120/min item budget is allowed", okCount === 120);
check("burst: the remaining 5 are 429", limited === 5);
check("burst: views counter stopped at the budget (no inflation past the limit)", (await viewsOf(productB)) === productBViews0 + 120);

// --- P3-4: rollup (idempotent) + analytics API + CSV -------------------------------
// Expected for A today: scan=1 (Table 7), menu_open=1, item_view=3
// (alpha table-attributed, beta table-attributed, gamma unattributed).
const roll = await run("node", ["scripts/rollup-analytics.mjs", `--day=${todayUtc}`], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: DB } });
check("rollup script runs for today", roll.stdout.includes("rollup"));
const agg = async (metric, dt, di) => (await pool.query("SELECT count FROM analytics_daily WHERE business_id = $1 AND day = $2 AND metric = $3 AND dimension_type = $4 AND dimension_id = $5", [businessA, todayUtc, metric, dt, di])).rows[0]?.count;
check("rollup: scan/all = 1", (await agg("scan", "all", "")) === 1);
check("rollup: scan by Table 7 = 1", (await agg("scan", "table", table7.id)) === 1);
check("rollup: menu_open/all = 1", (await agg("menu_open", "all", "")) === 1);
check("rollup: item_view/all = 3", (await agg("item_view", "all", "")) === 3);
check("rollup: item_view by dish = 3", (await agg("item_view", "item", productA)) === 3);
check("rollup: item_view by Table 7 = 2", (await agg("item_view", "table", table7.id)) === 2);
const roll2 = await run("node", ["scripts/rollup-analytics.mjs", `--day=${todayUtc}`], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: DB } });
check("rollup re-run does not double-count (idempotent)", roll2.stdout.includes("rollup") && (await agg("item_view", "all", "")) === 3 && (await agg("scan", "all", "")) === 1);

const analyticsAnon = await api("/api/analytics");
check("analytics without a session -> 401", analyticsAnon.status === 401);
const anA = await api("/api/analytics?days=7", { cookie: cookieA });
check("analytics API: A's totals come from real events (scan 1, menu_open 1, item_view 3)", anA.status === 200 && anA.json?.totals?.scan === 1 && anA.json?.totals?.menu_open === 1 && anA.json?.totals?.item_view === 3);
check("analytics API: byTable names Table 7 with its scan", Array.isArray(anA.json?.byTable) && anA.json.byTable.some((t) => t.id === table7.id && t.label === "Table 7" && t.counts.scan === 1));
check("analytics API: byItem ranks A's dish with 3 item views", Array.isArray(anA.json?.byItem) && anA.json.byItem[0]?.id === productA && anA.json.byItem[0]?.total === 3);
const anB = await api("/api/analytics?days=7", { cookie: cookieB });
check("analytics API: B sees only B's numbers (item_view 120 from the burst)", anB.status === 200 && anB.json?.totals?.item_view === 120 && !anB.json?.totals?.scan);
const csv = await api("/api/analytics?format=csv&days=7", { cookie: cookieA });
check("CSV export is server-generated from the aggregates", csv.status === 200 && csv.contentType.includes("text/csv") && csv.text.startsWith("day,metric,dimension_type,dimension_id,count") && csv.text.includes(`${todayUtc},scan,all,,1`));

// Deleting a table: its QR dies with it; past events keep their aggregates
// but lose the table reference (FK set-null), and its code stops resolving.
const del7 = await api(`/api/tables/${table7.id}`, { method: "DELETE", cookie: cookieA });
check("A deletes Table 7", del7.status === 200);
const resolveDead = await api(`/m/${code7}`);
check("deleted table's code -> 404", resolveDead.status === 404);
const orphaned = (await pool.query("SELECT count(*)::int c FROM guest_events WHERE business_id = $1 AND table_id = $2", [businessA, table7.id])).rows[0].c;
const stillThere = (await pool.query("SELECT count(*)::int c FROM guest_events WHERE business_id = $1 AND type = 'scan'", [businessA])).rows[0].c;
check("past events survive with the table reference nulled", orphaned === 0 && stillThere === 1);

// Deactivating B's master QR stops it resolving; reactivating restores it.
const off = await api(`/api/qr/${masterB.id}`, { method: "PATCH", cookie: cookieB, body: { active: false } });
const resolveOff = await api(`/m/${masterB.code}`);
check("deactivated master QR -> 404", off.status === 200 && resolveOff.status === 404);
const on = await api(`/api/qr/${masterB.id}`, { method: "PATCH", cookie: cookieB, body: { active: true } });
const resolveOn = await api(`/m/${masterB.code}`);
check("reactivated master QR resolves again (302 to B's menu)", on.status === 200 && resolveOn.status === 302 && (resolveOn.location || "").endsWith(`/menu/${businessB}?t=${masterB.code}`));

await pool.end();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
