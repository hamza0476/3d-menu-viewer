// CSRF defence for cookie-authenticated mutations.
// Browsers always send an Origin header on cross-origin (and same-origin
// POST) fetch/form requests, and a cross-site attacker cannot forge it to
// match our host. Combined with the SameSite=Lax session cookie, checking
// Origin on state-changing API calls closes the CSRF gap. Requests with no
// Origin header at all (curl, server-to-server, health checks) are not a
// browser CSRF vector and are allowed through.

export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true; // no Origin header -> not a browser CSRF attempt
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // unparseable Origin -> treat as hostile
  }
}

export const CSRF_PROTECTED_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
