// End-to-end test of the Phase 2 LEGACY migration path:
//   baseline DB with base64 assets.data rows
//     -> `npm run db:migrate` must REFUSE (guarded 0002) and lose nothing
//     -> `npm run assets:migrate` moves bytes to storage, sha256-verified
//     -> `npm run db:migrate` now succeeds and drops the data column
//     -> the migrated asset serves through the app under the S6 rules
// Run via tests/integration/run-migration-test.sh (which prepares a
// baseline-only database + production build and exports PGDATABASE_URL).
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash, randomBytes, scryptSync } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import pg from "pg";

const run = promisify(execFile);
const BASE = process.env.BASE || "http://127.0.0.1:3100";
const DB = process.env.PGDATABASE_URL;
const STORAGE_DIR = process.env.ASSET_STORAGE_DIR;
const REPORT = process.env.MIGRATION_REPORT;
if (!DB || !STORAGE_DIR || !REPORT) { console.error("PGDATABASE_URL, ASSET_STORAGE_DIR, MIGRATION_REPORT required"); process.exit(2); }

let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failures++;
}
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const appEnv = { ...process.env, DATABASE_URL: DB, ASSET_STORAGE_DIR: STORAGE_DIR };

async function migrate() {
  try {
    await run("npx", ["drizzle-kit", "migrate"], { cwd: repoRoot, env: appEnv });
    return 0;
  } catch (e) {
    return e.code ?? 1;
  }
}

// --- Fixtures + legacy seed ----------------------------------------------------
function pngFixture() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(3, 0); ihdr.writeUInt32BE(5, 4); ihdr[8] = 8; ihdr[9] = 2;
  const chunk = Buffer.alloc(25);
  chunk.writeUInt32BE(13, 0); chunk.write("IHDR", 4, "latin1"); ihdr.copy(chunk, 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk]);
}
const png = pngFixture();
const password = "legacy-owner-password-1";
const salt = randomBytes(16).toString("hex");
const storedPassword = salt + ":" + scryptSync(password, salt, 64).toString("hex");

const pool = new pg.Pool({ connectionString: DB });
await pool.query("INSERT INTO users (id, name, email, password) VALUES ('legacyowner1', 'Legacy Owner', 'legacy@example.com', $1)", [storedPassword]);
await pool.query("INSERT INTO assets (id, owner_id, data, mime) VALUES ('legacyasset1', 'legacyowner1', $1, 'image/png')", [png.toString("base64")]);
check("legacy baseline seeded (base64 row present)", true);

// --- 1. db:migrate must refuse while bytes are unmigrated -----------------------
const refusedCode = await migrate();
check("db:migrate on unmigrated legacy DB exits non-zero (guard)", refusedCode !== 0);
const stillThere = await pool.query("SELECT data FROM assets WHERE id = 'legacyasset1'");
check("legacy bytes untouched after refused migration", stillThere.rows[0]?.data === png.toString("base64"));

// --- 2. The migration tool moves + verifies the bytes ---------------------------
let toolCode = 0;
try {
  await run("node", ["scripts/migrate-assets-to-storage.mjs", "--report", REPORT], { cwd: repoRoot, env: appEnv });
} catch (e) { toolCode = e.code ?? 1; }
check("assets:migrate exits 0", toolCode === 0);
const report = JSON.parse(readFileSync(REPORT, "utf8"));
check("report: 1 asset, migrated, sha256 before == after", report.total === 1 && report.migrated === 1 && report.failed === 0 && report.assets[0]?.ok === true && report.assets[0]?.sha256Before === sha256(png) && report.assets[0]?.sha256After === sha256(png));
const rowRes = await pool.query("SELECT storage_key, kind, bytes, width, height, sha256 FROM assets WHERE id = 'legacyasset1'");
const row = rowRes.rows[0];
check("row filled: kind/bytes/dims/sha + storage_key", row?.kind === "photo" && row?.bytes === png.length && row?.width === 3 && row?.height === 5 && row?.sha256 === sha256(png) && !!row?.storage_key);
const onDisk = row ? readFileSync(path.join(STORAGE_DIR, row.storage_key)) : null;
check("object in storage is byte-identical to the legacy original", !!onDisk && onDisk.equals(png));

// --- 3. db:migrate now succeeds and drops the column -----------------------------
const okCode = await migrate();
check("db:migrate after the tool exits 0", okCode === 0);
const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'assets'");
check("assets.data column is gone", !cols.rows.some((r) => r.column_name === "data"));

// --- 4. The app serves the migrated asset under S6 rules --------------------------
const server = await (async () => {
  const { spawn } = await import("child_process");
  const proc = spawn("npx", ["next", "start", "-p", "3103"], { cwd: repoRoot, env: appEnv, stdio: "ignore" });
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch("http://127.0.0.1:3103/api/health"); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return proc;
})();
try {
  const anon = await fetch(BASE.replace("3100", "3103") + "/api/assets/legacyasset1", { redirect: "manual" });
  check("migrated asset: anonymous -> 404 (private, unreferenced)", anon.status === 404);
  const login = await fetch("http://127.0.0.1:3103/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "legacy@example.com", password }),
  });
  const setCookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [];
  const session = setCookies.map((c) => c.match(/platera_session=([^;]+)/)?.[1]).find(Boolean);
  check("legacy owner can still log in", login.ok && !!session);
  const owned = await fetch("http://127.0.0.1:3103/api/assets/legacyasset1", { headers: { Cookie: `platera_session=${session}` } });
  const body = Buffer.from(await owned.arrayBuffer());
  check("migrated asset: owner -> 200, byte-identical body", owned.status === 200 && body.equals(png));
} finally {
  server.kill("SIGTERM");
}

await pool.end();
console.log(failures === 0 ? "ALL MIGRATION CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
