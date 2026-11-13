// Integration tests for the prefetch-safe email verification flow (P1-8 / S9):
// opening the emailed link (GET) must NOT consume the token — mail scanners
// prefetch links — only the explicit confirmation POST may consume it.
// The raw token is recovered from the server log (email fallback path).
// Run via tests/integration/run.sh (fresh database per run).
import { readFileSync } from "fs";
import pg from "pg";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const DB = process.env.PGDATABASE_URL;
const LOG = process.env.SERVER_LOG;
if (!DB || !LOG) { console.error("PGDATABASE_URL and SERVER_LOG are required"); process.exit(2); }

let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failures++;
}

const pool = new pg.Pool({ connectionString: DB });
const email = `verify-${Date.now()}@example.com`;

// 1. Register -> a verify token is issued
const reg = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ action: "register", name: "Verify Tester", email, password: "verify-me-password-1", businessName: "Verify Dhaba" }),
});
check("register succeeds", reg.status === 200);
const tokCount = await pool.query("SELECT count(*)::int AS n FROM verification_tokens WHERE type='verify'");
check("one verify token stored (hashed)", tokCount.rows[0].n === 1);

const logText = readFileSync(LOG, "utf8");
const m = [...logText.matchAll(/api\/verify\?token=([0-9a-f]{64})/g)];
const rawToken = m.length ? m[m.length - 1][1] : null;
check("raw verify token recovered from emailed link", !!rawToken);

// 2. GET on the link (what a mail scanner does) must NOT verify anything
const get = await fetch(`${BASE}/api/verify?token=${rawToken}`, { redirect: "manual" });
check("GET redirects to the confirmation page", get.status >= 300 && get.status < 400 && (get.headers.get("location") || "").includes("/verify-email"));
const afterGet = await pool.query("SELECT email_verified FROM users WHERE email = $1", [email]);
check("GET did NOT mark the email verified", afterGet.rows[0].email_verified === false);
const tokAfterGet = await pool.query("SELECT count(*)::int AS n FROM verification_tokens WHERE type='verify'");
check("GET did NOT consume the token", tokAfterGet.rows[0].n === 1);

// 3. The confirmation page itself renders
const page = await fetch(`${BASE}/verify-email?token=${rawToken}`);
check("confirmation page renders (200)", page.status === 200);

// 4. POST consumes the token and verifies — exactly once
const post = await fetch(`${BASE}/api/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ token: rawToken }),
});
check("POST confirm succeeds", post.status === 200);
const afterPost = await pool.query("SELECT email_verified FROM users WHERE email = $1", [email]);
check("email is now verified", afterPost.rows[0].email_verified === true);
const reuse = await fetch(`${BASE}/api/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ token: rawToken }),
});
check("reusing the same token fails (400)", reuse.status === 400);

// 5. Garbage token: GET still lands on the page (no error leak), POST fails
const getBad = await fetch(`${BASE}/api/verify?token=${"0".repeat(64)}`, { redirect: "manual" });
check("GET with a bad token still redirects to the page", getBad.status >= 300 && getBad.status < 400);
const postBad = await fetch(`${BASE}/api/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ token: "0".repeat(64) }),
});
check("POST with a bad token fails (400)", postBad.status === 400);

await pool.end();
console.log(failures === 0 ? "ALL INTEGRATION CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
