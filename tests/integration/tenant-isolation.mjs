// Tenant-isolation integration tests (P1-7): two registered owners, A and B.
// B must not be able to read, edit, delete or rename anything of A's, and
// unauthenticated calls must be rejected. Run via tests/integration/run.sh.
import pg from "pg";

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
  for (const c of cookies) {
    const m = c.match(/platera_session=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}
async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Origin: BASE, ...(cookie ? { Cookie: `platera_session=${cookie}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, setCookie: cookieOf(res) };
}

const pool = new pg.Pool({ connectionString: DB });
const stamp = Date.now();
const pwA = `A-owner-${stamp}-pass!`;
const pwB = `B-owner-${stamp}-pass!`;

// --- Setup: A and B register, A adds a product -------------------------------
const regA = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner A", email: `a-${stamp}@example.com`, password: pwA, businessName: "A's Place" } });
const cookieA = regA.setCookie;
check("owner A registers", regA.json?.ok === true && !!cookieA);
const regB = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner B", email: `b-${stamp}@example.com`, password: pwB, businessName: "B's Place" } });
const cookieB = regB.setCookie;
check("owner B registers", regB.json?.ok === true && !!cookieB && cookieB !== cookieA);

const created = await api("/api/products", { method: "POST", cookie: cookieA, body: { name: "A's Secret Dish", price: 1500, category: "Mains" } });
check("A creates a product", created.status === 200 && created.json?.name === "A's Secret Dish");
const productA = created.json?.id;

// --- B attacks A's tenant -----------------------------------------------------
const patchAttack = await api("/api/products", { method: "PATCH", cookie: cookieB, body: { id: productA, name: "Hacked Dish", price: 1 } });
check("B cannot PATCH A's product (404)", patchAttack.status === 404);

const deleteAttack = await api("/api/products", { method: "DELETE", cookie: cookieB, body: { id: productA } });
check("B cannot DELETE A's product (404)", deleteAttack.status === 404);

const wsAttack = await api("/api/workspace", { method: "PATCH", cookie: cookieB, body: { name: "B Renamed", published: false } });
check("B's workspace PATCH succeeds for B's own business", wsAttack.status === 200 && wsAttack.json?.name === "B Renamed");

const catB = await api("/api/categories", { method: "POST", cookie: cookieB, body: { name: "B Only Category" } });
check("B can add a category to B's own business", catB.status === 200);

// --- Ground truth in the database --------------------------------------------
const prodRow = await pool.query("SELECT name, price FROM products WHERE id = $1", [productA]);
check("A's product is untouched in the DB (name + price)", prodRow.rows[0]?.name === "A's Secret Dish" && prodRow.rows[0]?.price === 1500);
const aBiz = await pool.query("SELECT b.name, b.categories FROM businesses b JOIN users u ON u.id = b.owner_id WHERE u.email = $1", [`a-${stamp}@example.com`]);
check("A's business name unchanged (B's PATCH hit only B)", aBiz.rows[0]?.name === "A's Place");
check("A's categories do not contain B's category", !(aBiz.rows[0]?.categories || []).includes("B Only Category"));

// --- Each owner sees only their own workspace ---------------------------------
const wsA = await api("/api/workspace", { cookie: cookieA });
check("A's workspace shows A's product", (wsA.json?.products || []).some((p) => p.id === productA));
const wsB = await api("/api/workspace", { cookie: cookieB });
check("B's workspace does NOT show A's product", !(wsB.json?.products || []).some((p) => p.id === productA));
check("B's workspace shows B's renamed business", wsB.json?.business?.name === "B Renamed");

// --- Unauthenticated -----------------------------------------------------------
const anon = await api("/api/products", { method: "POST", body: { name: "Anon Dish", price: 1 } });
check("unauthenticated product creation is rejected (401)", anon.status === 401);

await pool.end();
console.log(failures === 0 ? "ALL INTEGRATION CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
