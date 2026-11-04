// Integration tests for demo-workspace abuse limits (P1-5 / S7):
// anonymous visitors auto-get a demo workspace, but one connection may only
// create 5 per hour, and demo sessions live 1 day (not 30).
// Run via tests/integration/run.sh (fresh database per run).
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

const pool = new pg.Pool({ connectionString: DB });

// 1. First anonymous visit creates a demo workspace and returns a session.
const first = await fetch(`${BASE}/api/workspace`);
const firstJson = await first.json();
check("first anonymous workspace request succeeds", first.status === 200 && firstJson?.user?.demo === true);
const demoCookie = cookieOf(first);
check("demo session cookie issued", !!demoCookie);

// 2. Reusing the demo cookie must NOT create more users.
await fetch(`${BASE}/api/workspace`, { headers: { Cookie: `platera_session=${demoCookie}` } });
await fetch(`${BASE}/api/workspace`, { headers: { Cookie: `platera_session=${demoCookie}` } });
let demoUsers = await pool.query("SELECT count(*)::int AS n FROM users WHERE demo = true");
check("repeat visits with the cookie create no extra demo users", demoUsers.rows[0].n === 1);

// 3. Demo session lifetime is ~1 day, not 30.
// The expires column is `timestamp` (no time zone): node-pg would parse it in
// THIS process's local zone and skew the maths by the UTC offset, so read the
// raw string and parse it as UTC (which is how the app wrote it).
pg.types.setTypeParser(1114, (v) => v);
const sess = await pool.query("SELECT expires FROM sessions LIMIT 1");
const expiresMs = Date.parse(String(sess.rows[0].expires).replace(" ", "T") + "Z");
const hours = (expiresMs - Date.now()) / 3600000;
check(`demo session expires in ~24h (actual ${hours.toFixed(1)}h)`, hours > 20 && hours < 28);

// 4. Four more fresh anonymous creations succeed (total 5), the 6th is a 429.
let codes = [];
for (let i = 0; i < 5; i++) {
  const r = await fetch(`${BASE}/api/workspace`);
  codes.push(r.status);
  await r.text();
}
check("creations 2-5 succeed (200)", codes.slice(0, 4).every((c) => c === 200));
check("6th demo creation from the same connection is rate-limited (429)", codes[4] === 429);
demoUsers = await pool.query("SELECT count(*)::int AS n FROM users WHERE demo = true");
check("exactly 5 demo users exist after the limit trips", demoUsers.rows[0].n === 5);

// 5. The existing demo user is unaffected by the creation limit.
const again = await fetch(`${BASE}/api/workspace`, { headers: { Cookie: `platera_session=${demoCookie}` } });
check("existing demo session still loads while creation is limited", again.status === 200);

await pool.end();
console.log(failures === 0 ? "ALL INTEGRATION CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
