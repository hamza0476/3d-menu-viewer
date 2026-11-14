// QR codes & guest-event primitives (Phase 3 — fixes G2, G11, S12).
//
// A printed QR encodes /m/<code>, where <code> is a short random token that
// resolves server-side to the restaurant's menu (with table context when the
// code belongs to a table). Because the token — not the menu URL — is what
// gets printed, a code can be re-pointed or revoked without reprinting, and
// every scan is attributable to the exact table that was scanned.
import { randomBytes, createHash } from "crypto";

// 31 unambiguous characters (no 0/O/1/l/I/o). Codes are picked by rejection
// sampling — bytes >= 248 (31 * 8) are discarded — so every character is
// equally likely. 12 chars ≈ 59 bits of entropy: unguessable in practice
// for a token whose only power is "open a public menu, attributed".
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const QR_CODE_LENGTH = 12;

export function generateQrCode(): string {
  let code = "";
  while (code.length < QR_CODE_LENGTH) {
    for (const b of randomBytes(QR_CODE_LENGTH * 2)) {
      if (b >= 248) continue;
      code += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (code.length === QR_CODE_LENGTH) break;
    }
  }
  return code;
}

export function isQrCodeShape(value: unknown): value is string {
  return typeof value === "string" && value.length === QR_CODE_LENGTH && [...value].every((c) => CODE_ALPHABET.includes(c));
}

// The path a printed QR encodes and the path a guest lands on after the
// resolver redirects. `t` carries the code so the menu page (and its event
// posts) can attribute the visit to the table.
export const qrResolvePath = (code: string) => `/m/${code}`;
export const qrMenuPath = (businessId: string, code: string) => `/menu/${businessId}?t=${code}`;

// Guest event types (master plan §4.4). This phase's guest UI emits `scan`
// (QR resolve), `menu_open` (menu page loaded) and `item_view` (a dish was
// opened in the viewer). `3d_open` is reserved for the Phase 4 viewer, which
// will be able to distinguish "dish opened" from "3D actually engaged".
export const EVENT_TYPES = ["scan", "menu_open", "item_view", "3d_open"] as const;
export type GuestEventType = (typeof EVENT_TYPES)[number];
export const isGuestEventType = (v: unknown): v is GuestEventType => typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v);

// Privacy: the anonymous session id a guest browser generates per session is
// never stored raw — only its SHA-256 hash reaches the database, so the raw
// events table cannot be used to correlate a guest across days even if it
// leaks. It exists solely for short-window de-duplication (S12).
export const hashSessionAnonId = (raw: string) => createHash("sha256").update(raw).digest("hex");

// Coarse device class from the user agent — deliberately nothing finer.
// No user-agent string itself is stored anywhere.
export function deviceClass(userAgent: string | null | undefined): "mobile" | "tablet" | "desktop" | "unknown" {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|kindle|silk/.test(ua)) return "tablet";
  if (/android/.test(ua) && !/mobile/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|windows phone/.test(ua)) return "mobile";
  return "desktop";
}

// Spam control for the public event endpoint (S12). Two layers:
// - a per-connection rate limit (Phase 1 limiter, enforced in the route), and
// - per-session de-duplication: the same session re-opening the same dish
//   inside this window is one event, not many — a guest idly tapping, or a
//   script replaying one session, cannot inflate counters.
export const EVENT_DEDUPE_WINDOW_MS = 60_000;
export function shouldCountEvent(lastCountedAt: number | null, now: number, windowMs = EVENT_DEDUPE_WINDOW_MS): boolean {
  return lastCountedAt === null || now - lastCountedAt >= windowMs;
}
