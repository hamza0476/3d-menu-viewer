// HTTP-level integration tests for the auth token lifecycle.
// Run against a locally started server with a throwaway database:
//   BASE=http://127.0.0.1:3100 PGDATABASE_URL=postgresql://... node tests/integration/auth-flow.mjs
// The script reads the server log file (SERVER_LOG env) to recover the raw
// password-reset link that the app logs when RESEND_API_KEY is unset.
import { createHash } from "crypto";
import { readFileSync } from "fs";
import pg from "pg";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const DB = process.env.PGDATABASE_URL;
const LOG = process.env.SERVER_LOG;
if (!DB) { console.error("PGDATABASE_URL is required"); process.exit(2); }

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failures++;
}
function sessionCookie(res) {
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
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: `platera_session=${cookie}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { res, json, setCookie: sessionCookie(res) };
}

const pool = new pg.Pool({ connectionString: DB });
const email = `int-${Date.now()}@example.com`;
const password = "integration-password-1";

// 1. Register -> session cookie issued
const reg = await api("/api/auth", { method: "POST", body: { action: "register", name: "Integration Tester", email, password, businessName: "Test Dhaba" } });
check("register returns ok", reg.json?.ok === true);
const rawSession = reg.setCookie;
check("register sets a session cookie", !!rawSession);

// 2. The database must store ONLY the hash of that session token
const sessRows = await pool.query("SELECT token FROM sessions");
check("exactly one session row exists", sessRows.rows.length === 1);
const storedSession = sessRows.rows[0]?.token;
check("stored session token != raw cookie token", storedSession !== rawSession);
check("stored session token == sha256(raw cookie token)", storedSession === sha256(rawSession));

// 3. Raw cookie authenticates; the stored (leaked) value must NOT
const meOk = await api("/api/session", { cookie: rawSession });
check("raw session cookie authenticates", meOk.json?.authenticated === true);
const meLeak = await api("/api/session", { cookie: storedSession });
check("database-stored value used as cookie does NOT authenticate (DB leak != hijack)", meLeak.json?.authenticated === false);

// 4. Logout deletes the hashed session row
const out = await api("/api/auth", { method: "POST", body: { action: "logout" }, cookie: rawSession });
check("logout returns ok", out.json?.ok === true);
const afterOut = await pool.query("SELECT count(*)::int AS n FROM sessions");
check("session row deleted on logout", afterOut.rows[0].n === 0);
const meAfter = await api("/api/session", { cookie: rawSession });
check("old cookie no longer authenticates after logout", meAfter.json?.authenticated === false);

// 5. Login again, then forgot-password: token stored hashed, raw token works once
const login = await api("/api/auth", { method: "POST", body: { action: "login", email, password } });
check("login returns ok", login.json?.ok === true);
const forgot = await api("/api/auth", { method: "POST", body: { action: "forgot", email } });
check("forgot returns ok (generic)", forgot.json?.ok === true);
const tokRows = await pool.query("SELECT token FROM verification_tokens WHERE type='reset'");
check("one reset token row exists", tokRows.rows.length === 1);
const storedReset = tokRows.rows[0]?.token;

// Recover the raw reset token from the server console log (email fallback path)
let rawReset = null;
if (LOG) {
  const logText = readFileSync(LOG, "utf8");
  const matches = [...logText.matchAll(/reset-password\?token=([0-9a-f]{64})/g)];
  rawReset = matches.length ? matches[matches.length - 1][1] : null;
}
check("raw reset token recovered from emailed link", !!rawReset);
if (rawReset) {
  check("stored reset token == sha256(raw emailed token)", storedReset === sha256(rawReset));
  check("stored reset token != raw emailed token", storedReset !== rawReset);
  const badReset = await api("/api/auth", { method: "POST", body: { action: "reset", token: storedReset, password: "integration-password-2" } });
  check("reset with the database-stored value FAILS", badReset.res.status === 400);
  const goodReset = await api("/api/auth", { method: "POST", body: { action: "reset", token: rawReset, password: "integration-password-2" } });
  check("reset with the raw emailed token succeeds", goodReset.json?.ok === true);
  const reuse = await api("/api/auth", { method: "POST", body: { action: "reset", token: rawReset, password: "integration-password-3" } });
  check("reset token is single-use (reuse fails)", reuse.res.status === 400);
  const oldLogin = await api("/api/auth", { method: "POST", body: { action: "login", email, password } });
  check("old password rejected after reset", oldLogin.res.status === 401);
  const newLogin = await api("/api/auth", { method: "POST", body: { action: "login", email, password: "integration-password-2" } });
  check("new password works after reset", newLogin.json?.ok === true);
}

await pool.end();
console.log(failures === 0 ? "ALL INTEGRATION CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
