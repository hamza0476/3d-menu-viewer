// Phase 6 integration suite: team memberships + roles, invites, the
// Pakistan pack and the audit trail — including the automated version of
// the plan's acceptance flow (fresh PK signup -> PK template -> dish with
// Urdu + spice fields -> invite a teammate -> publish -> guest book in
// Urdu shows the fields -> table QR resolves).
//
// Run with the platform admin's email in the server env, e.g.:
//   ADMIN_EMAILS=admin-p6@example.com bash tests/integration/run.sh tests/integration/team-pakistan.mjs
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
  return { status: res.status, json, text, setCookie: cookieOf(res) };
}

const pool = new pg.Pool({ connectionString: DB });
const stamp = Date.now();
const pw = (who) => `${who}-${stamp}-Pass!9x`;
const ADMIN_EMAIL = "admin-p6@example.com";

// --- Platform admin registers (requireAdmin matches this email) --------------
const regAdmin = await api("/api/auth", { method: "POST", body: { action: "register", name: "Platform Admin", email: ADMIN_EMAIL, password: pw("admin"), businessName: "Admin HQ" } });
const cookieAdmin = regAdmin.setCookie;
check("admin registers", regAdmin.json?.ok === true && !!cookieAdmin);

// --- Fresh PK signup with the Desi template (acceptance flow, part 1) --------
const ownerEmail = `owner-${stamp}@example.com`;
const regOwner = await api("/api/auth", { method: "POST", body: { action: "register", name: "Test Owner", email: ownerEmail, password: pw("owner"), businessName: "Test Zaika", template: "desi" } });
const cookieOwner = regOwner.setCookie;
check("PK owner registers with the desi template", regOwner.json?.ok === true && !!cookieOwner);
await pool.query("UPDATE users SET email_verified = true WHERE email = $1", [ownerEmail]);

const ws = await api("/api/workspace", { cookie: cookieOwner });
const biz = ws.json?.business;
check("workspace role is owner", ws.json?.role === "owner");
check("new signup defaults to PKR", biz?.currency === "PKR");
check("desi template categories applied", JSON.stringify(biz?.categories) === JSON.stringify(["Starters", "Karahi & Handi", "Biryani & Rice", "Breads", "Desserts", "Drinks"]));
check("Urdu categories aligned with the template", biz?.categoriesUr?.[1] === "کڑاہی اور ہانڈی" && biz?.categoriesUr?.length === biz?.categories?.length);
const ownerRow = await pool.query("SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1", [ownerEmail]);
check("owner membership row exists (role owner)", ownerRow.rows[0]?.role === "owner");
const bizId = biz?.id;

// --- Dish with Urdu + spice + serves (acceptance flow, part 2) ---------------
const dish = await api("/api/products", { method: "POST", cookie: cookieOwner, body: { name: "Test Karahi", nameUr: "ٹیسٹ کڑاہی", description: "A test karahi.", descriptionUr: "ایک آزمائشی کڑاہی۔", price: 100000, category: "Karahi & Handi", spiceLevel: "hot", serves: "Serves 2" } });
check("owner creates a dish with Urdu + spice + serves", dish.status === 200 && dish.json?.nameUr === "ٹیسٹ کڑاہی" && dish.json?.spiceLevel === "hot" && dish.json?.serves === "Serves 2");
const dishId = dish.json?.id;
const badSpice = await api("/api/products", { method: "PATCH", cookie: cookieOwner, body: { id: dishId, name: "Test Karahi", price: 100000, category: "Karahi & Handi", spiceLevel: "nuclear" } });
check("an invalid spice level is stored as null, never passed through", badSpice.status === 200 && badSpice.json?.spiceLevel === null);
await api("/api/products", { method: "PATCH", cookie: cookieOwner, body: { id: dishId, name: "Test Karahi", nameUr: "ٹیسٹ کڑاہی", description: "A test karahi.", descriptionUr: "ایک آزمائشی کڑاہی۔", price: 100000, category: "Karahi & Handi", spiceLevel: "hot", serves: "Serves 2" } });

// --- Invite a manager (acceptance flow, part 3) -------------------------------
const managerEmail = `manager-${stamp}@example.com`;
const inv = await api("/api/team/invites", { method: "POST", cookie: cookieOwner, body: { email: managerEmail, role: "manager" } });
check("owner invites a manager", inv.status === 200 && inv.json?.ok === true);
check("no email provider configured -> the invite link is surfaced, not fake-sent", inv.json?.delivered === false && typeof inv.json?.inviteUrl === "string");
const managerToken = (inv.json?.inviteUrl || "").split("/invite/")[1];
check("invite link carries a token", !!managerToken);
const auditInvite = await pool.query("SELECT action FROM audit_log WHERE business_id = $1 AND action = 'invite.created'", [bizId]);
check("audit: invite.created recorded", auditInvite.rows.length >= 1);
const inviteRow = await pool.query("SELECT token FROM invites WHERE email = $1", [managerEmail]);
check("only the token HASH is stored", inviteRow.rows[0]?.token?.length === 64 && inviteRow.rows[0]?.token !== managerToken);

// Wrong person cannot accept.
const regWrong = await api("/api/auth", { method: "POST", body: { action: "register", name: "Wrong Person", email: `wrong-${stamp}@example.com`, password: pw("wrong"), businessName: "Wrong Place" } });
const wrongAccept = await api("/api/invites/accept", { method: "POST", cookie: regWrong.setCookie, body: { token: managerToken } });
check("accepting someone else's invite is refused (403)", wrongAccept.status === 403);

// The invite page itself never consumes (mail-scanner safe).
const invitePage = await fetch(`${BASE}/invite/${managerToken}`);
check("invite landing page renders on GET", invitePage.status === 200 && (await invitePage.text()).includes("Test Zaika"));

// Manager accepts by creating an account through the invite.
const acceptM = await api("/api/invites/accept", { method: "POST", body: { token: managerToken, name: "Manager M", password: pw("manager") } });
const cookieManager = acceptM.setCookie;
check("manager accepts and gets a session", acceptM.status === 200 && !!cookieManager);
const memberRow = await pool.query("SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1 AND m.business_id = $2", [managerEmail, bizId]);
check("membership created with role manager", memberRow.rows[0]?.role === "manager");
const acceptAgain = await api("/api/invites/accept", { method: "POST", cookie: cookieManager, body: { token: managerToken } });
check("the same invite cannot be accepted twice (400)", acceptAgain.status === 400);
const auditAccept = await pool.query("SELECT action FROM audit_log WHERE business_id = $1 AND action = 'invite.accepted'", [bizId]);
check("audit: invite.accepted recorded", auditAccept.rows.length >= 1);

// --- Role matrix: manager ------------------------------------------------------
const wsM = await api("/api/workspace", { cookie: cookieManager });
check("manager lands in the owner's restaurant with role manager", wsM.json?.business?.id === bizId && wsM.json?.role === "manager");
const mDish = await api("/api/products", { method: "POST", cookie: cookieManager, body: { name: "Manager Dish", price: 5000, category: "Starters" } });
check("manager CAN add a dish", mDish.status === 200);
const mRename = await api("/api/workspace", { method: "PATCH", cookie: cookieManager, body: { ...wsM.json.business, tagline: "Manager was here" } });
check("manager CAN update restaurant settings", mRename.status === 200);
const mAnalytics = await api("/api/analytics", { cookie: cookieManager });
check("manager CAN view analytics", mAnalytics.status === 200);
const mTable = await api("/api/tables", { method: "POST", cookie: cookieManager, body: { label: "Table 9", seats: 4 } });
check("manager CAN create a table + QR", mTable.status === 201 && !!mTable.json?.qr?.code);
const tableCode = mTable.json?.qr?.code;
const mInvite = await api("/api/team/invites", { method: "POST", cookie: cookieManager, body: { email: `nope-${stamp}@example.com`, role: "staff" } });
check("manager CANNOT invite (403)", mInvite.status === 403);
const teamList = await api("/api/team", { cookie: cookieOwner });
const managerUserId = teamList.json?.members?.find((m) => m.email === managerEmail)?.userId;
const mRoleChange = await api(`/api/team/members/${managerUserId}`, { method: "PATCH", cookie: cookieManager, body: { role: "staff" } });
check("manager CANNOT change roles (403)", mRoleChange.status === 403);

// --- Invite + accept a staff member; the staff end of the matrix ---------------
const staffEmail = `staff-${stamp}@example.com`;
const invS = await api("/api/team/invites", { method: "POST", cookie: cookieOwner, body: { email: staffEmail, role: "staff" } });
const staffToken = (invS.json?.inviteUrl || "").split("/invite/")[1];
const acceptS = await api("/api/invites/accept", { method: "POST", body: { token: staffToken, name: "Staff S", password: pw("staff") } });
const cookieStaff = acceptS.setCookie;
check("staff accepts the invite", acceptS.status === 200 && !!cookieStaff);
const wsS = await api("/api/workspace", { cookie: cookieStaff });
check("staff workspace role is staff", wsS.json?.role === "staff" && wsS.json?.business?.id === bizId);
const sCreate = await api("/api/products", { method: "POST", cookie: cookieStaff, body: { name: "Staff Dish", price: 100 } });
check("staff CANNOT create a dish (403)", sCreate.status === 403);
const sFullPatch = await api("/api/products", { method: "PATCH", cookie: cookieStaff, body: { id: dishId, name: "Hijacked", price: 1 } });
check("staff CANNOT edit a dish (403)", sFullPatch.status === 403);
const sToggle = await api("/api/products", { method: "PATCH", cookie: cookieStaff, body: { id: dishId, available: false } });
check("staff CAN toggle availability", sToggle.status === 200 && sToggle.json?.available === false);
const sToggleBack = await api("/api/products", { method: "PATCH", cookie: cookieStaff, body: { id: dishId, available: true } });
check("staff CAN toggle it back", sToggleBack.status === 200 && sToggleBack.json?.available === true);
const sSneaky = await api("/api/products", { method: "PATCH", cookie: cookieStaff, body: { id: dishId, available: false, name: "Hijacked" } });
check("staff CANNOT smuggle an edit into an availability toggle (403)", sSneaky.status === 403);
const sAnalytics = await api("/api/analytics", { cookie: cookieStaff });
check("staff CANNOT view analytics (403)", sAnalytics.status === 403);
const sTable = await api("/api/tables", { method: "POST", cookie: cookieStaff, body: { label: "Table X" } });
check("staff CANNOT create tables (403)", sTable.status === 403);
const sSettings = await api("/api/workspace", { method: "PATCH", cookie: cookieStaff, body: { name: "Staff Rename" } });
check("staff CANNOT change settings (403)", sSettings.status === 403);
const sInvite = await api("/api/team/invites", { method: "POST", cookie: cookieStaff, body: { email: `nope2-${stamp}@example.com`, role: "staff" } });
check("staff CANNOT invite (403)", sInvite.status === 403);
const sDelete = await api("/api/products", { method: "DELETE", cookie: cookieStaff, body: { id: dishId } });
check("staff CANNOT delete a dish (403)", sDelete.status === 403);

// --- Role change revokes sessions; removal too ---------------------------------
const staffUserId = teamList.json?.members?.find((m) => m.email === staffEmail)?.userId
  || (await api("/api/team", { cookie: cookieOwner })).json?.members?.find((m) => m.email === staffEmail)?.userId;
const roleChange = await api(`/api/team/members/${staffUserId}`, { method: "PATCH", cookie: cookieOwner, body: { role: "manager" } });
check("owner changes staff -> manager", roleChange.status === 200);
const staffOldSession = await api("/api/team", { cookie: cookieStaff });
check("role change revokes the member's old session (401)", staffOldSession.status === 401);
const auditRole = await pool.query("SELECT action FROM audit_log WHERE business_id = $1 AND action = 'member.role_changed'", [bizId]);
check("audit: member.role_changed recorded", auditRole.rows.length >= 1);
const loginS = await api("/api/auth", { method: "POST", body: { action: "login", email: staffEmail, password: pw("staff") } });
const wsS2 = await api("/api/workspace", { cookie: loginS.setCookie });
check("after re-login the new role applies (manager)", wsS2.json?.role === "manager");

const ownerUserId = teamList.json?.members?.find((m) => m.email === ownerEmail)?.userId;
const demoteOwner = await api(`/api/team/members/${ownerUserId}`, { method: "PATCH", cookie: cookieOwner, body: { role: "staff" } });
check("the owner's own role cannot be changed (400)", demoteOwner.status === 400);
const removeOwner = await api(`/api/team/members/${ownerUserId}`, { method: "DELETE", cookie: cookieOwner });
check("the owner cannot be removed (400)", removeOwner.status === 400);

const removeM = await api(`/api/team/members/${managerUserId}`, { method: "DELETE", cookie: cookieOwner });
check("owner removes the manager", removeM.status === 200);
const managerGone = await pool.query("SELECT id FROM memberships WHERE user_id = $1 AND business_id = $2", [managerUserId, bizId]);
check("membership row is gone after removal", managerGone.rows.length === 0);
const managerOldSession = await api("/api/team", { cookie: cookieManager });
check("removal revokes the member's session (401)", managerOldSession.status === 401);
const auditRemoved = await pool.query("SELECT action FROM audit_log WHERE business_id = $1 AND action = 'member.removed'", [bizId]);
check("audit: member.removed recorded", auditRemoved.rows.length >= 1);

// --- Expired + revoked invites ---------------------------------------------------
const expEmail = `expired-${stamp}@example.com`;
const invE = await api("/api/team/invites", { method: "POST", cookie: cookieOwner, body: { email: expEmail, role: "staff" } });
const expToken = (invE.json?.inviteUrl || "").split("/invite/")[1];
await pool.query("UPDATE invites SET expires = now() - interval '1 day' WHERE email = $1", [expEmail]);
const acceptExpired = await api("/api/invites/accept", { method: "POST", body: { token: expToken, name: "Too Late", password: pw("late") } });
check("an expired invite cannot be accepted (400)", acceptExpired.status === 400);

const revEmail = `revoked-${stamp}@example.com`;
await api("/api/team/invites", { method: "POST", cookie: cookieOwner, body: { email: revEmail, role: "staff" } });
const teamNow = await api("/api/team", { cookie: cookieOwner });
const revInvite = teamNow.json?.invites?.find((i) => i.email === revEmail);
check("pending invite is listed for the owner", !!revInvite);
const revoke = await api("/api/team/invites", { method: "DELETE", cookie: cookieOwner, body: { id: revInvite?.id } });
check("owner revokes the invite", revoke.status === 200);
const auditRevoke = await pool.query("SELECT action FROM audit_log WHERE business_id = $1 AND action = 'invite.revoked'", [bizId]);
check("audit: invite.revoked recorded", auditRevoke.rows.length >= 1);

// --- Publish + guest side (acceptance flow, parts 4-6) ---------------------------
const wsFresh = await api("/api/workspace", { cookie: cookieOwner });
const unpublish = await api("/api/workspace", { method: "PATCH", cookie: cookieOwner, body: { ...wsFresh.json.business, published: false } });
check("owner unpublishes", unpublish.status === 200 && unpublish.json?.published === false);
const guestOffline = await api(`/api/menu/${bizId}`);
check("guest payload is 404 while unpublished", guestOffline.status === 404);
const publish = await api("/api/workspace", { method: "PATCH", cookie: cookieOwner, body: { ...wsFresh.json.business, published: true } });
check("owner publishes again", publish.status === 200 && publish.json?.published === true);
const auditPublish = await pool.query("SELECT action FROM audit_log WHERE business_id = $1 AND action IN ('menu.publish', 'menu.unpublish')", [bizId]);
check("audit: publish + unpublish recorded", auditPublish.rows.length >= 2);

const payload = await api(`/api/menu/${bizId}`);
const guestDish = payload.json?.products?.find((p) => p.id === dishId);
check("guest payload carries the dish's Urdu name, spice and serves", guestDish?.nameUr === "ٹیسٹ کڑاہی" && guestDish?.spiceLevel === "hot" && guestDish?.serves === "Serves 2");
check("guest payload carries Urdu categories", payload.json?.business?.categoriesUr?.[1] === "کڑاہی اور ہانڈی");

// Table QR resolves to the menu with table context.
const qrRes = await fetch(`${BASE}/m/${tableCode}`, { redirect: "manual" });
const location = qrRes.headers.get("location") || "";
check("table QR resolves to this menu with the table code", (qrRes.status === 302 || qrRes.status === 307) && location.includes(`/menu/${bizId}`) && location.includes(`t=${tableCode}`));

// Real browser: switch the guest book to Urdu and see the Urdu dish data.
let browser = null;
try {
  browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
  const page = await browser.newPage();
  await page.goto(`${BASE}/menu/${bizId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Switch language" }).click();
  await page.waitForTimeout(400);
  // Jump to the karahi chapter — only the visible spread's text is in the
  // DOM text, and the dish lives two chapters in (Deals, then Starters).
  await page.getByRole("button", { name: /کڑاہی اور ہانڈی/ }).first().click();
  await page.waitForTimeout(700);
  const bodyText = await page.locator("body").innerText();
  check("browser: Urdu book shows the dish's Urdu name", bodyText.includes("ٹیسٹ کڑاہی"));
  check("browser: Urdu book shows the Urdu category chapter", bodyText.includes("کڑاہی اور ہانڈی"));
  const wrapDir = await page.locator(".book-wrap").getAttribute("dir").catch(() => null);
  check("browser: guest chrome is RTL in Urdu", wrapDir === "rtl");
} catch (e) {
  check("chromium guest checks: " + e.message, false);
} finally {
  if (browser) await browser.close();
}

// --- Admin: pagination, search, audit viewer --------------------------------------
const admPage1 = await api("/api/admin/businesses?limit=2&offset=0", { cookie: cookieAdmin });
check("admin list page 1 returns 2 rows + a total", admPage1.status === 200 && admPage1.json?.rows?.length === 2 && admPage1.json?.total >= 3);
const admPage2 = await api("/api/admin/businesses?limit=2&offset=2", { cookie: cookieAdmin });
check("admin list page 2 returns different rows", admPage2.status === 200 && admPage2.json?.rows?.length >= 1 && !admPage2.json.rows.some((r) => admPage1.json.rows.some((p) => p.id === r.id)));
const admSearch = await api(`/api/admin/businesses?q=${encodeURIComponent("Test Zaika")}`, { cookie: cookieAdmin });
check("admin search finds the restaurant by name", admSearch.json?.total === 1 && admSearch.json?.rows?.[0]?.id === bizId);
const admDenied = await api("/api/admin/businesses", { cookie: cookieOwner });
check("non-admin cannot read the admin list (403)", admDenied.status === 403);
const auditList = await api("/api/admin/audit?limit=50", { cookie: cookieAdmin });
const actions = new Set((auditList.json?.rows || []).map((r) => r.action));
check("audit viewer lists the phase's events", auditList.status === 200 && actions.has("invite.created") && actions.has("invite.accepted") && actions.has("member.role_changed") && actions.has("member.removed") && actions.has("menu.publish"));
const auditFiltered = await api("/api/admin/audit?action=invite.created", { cookie: cookieAdmin });
check("audit viewer filters by action", auditFiltered.json?.rows?.length >= 1 && auditFiltered.json.rows.every((r) => r.action === "invite.created"));
const auditDenied = await api("/api/admin/audit", { cookie: cookieOwner });
check("non-admin cannot read the audit log (403)", auditDenied.status === 403);

const suspend = await api(`/api/admin/businesses/${bizId}`, { method: "PATCH", cookie: cookieAdmin, body: { suspended: true } });
check("admin suspends the restaurant", suspend.status === 200 && suspend.json?.suspended === true);
const guestSuspended = await api(`/api/menu/${bizId}`);
check("suspended restaurant's menu is offline for guests", guestSuspended.status === 404);
const auditSuspend = await pool.query("SELECT action FROM audit_log WHERE business_id = $1 AND action = 'admin.suspend'", [bizId]);
check("audit: admin.suspend recorded", auditSuspend.rows.length >= 1);
const reinstate = await api(`/api/admin/businesses/${bizId}`, { method: "PATCH", cookie: cookieAdmin, body: { suspended: false } });
check("admin reinstates the restaurant", reinstate.status === 200 && reinstate.json?.suspended === false);
const auditReinstate = await pool.query("SELECT action FROM audit_log WHERE business_id = $1 AND action = 'admin.reinstate'", [bizId]);
check("audit: admin.reinstate recorded", auditReinstate.rows.length >= 1);

await pool.end();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
