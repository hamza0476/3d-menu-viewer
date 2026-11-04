import { createHash } from "crypto";

// Password policy for NEW passwords (register + reset). Existing passwords
// keep working at login — the policy only gates setting a password.
//  1. Length: 10–128 characters.
//  2. Breach check: the password must not appear in the Have I Been Pwned
//     breach corpus. The check uses k-anonymity: only the first 5 hex chars
//     of the password's SHA-1 leave this server; HIBP returns every breached
//     suffix for that prefix and the match is done locally. If HIBP is
//     unreachable the check fails OPEN (length still enforced) so an outage
//     there cannot lock sign-ups.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export async function passwordProblem(password: string): Promise<string | null> {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `Use a password of ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (await isBreached(password)) {
    return "That password has appeared in a data breach. Please choose a different one.";
  }
  return null;
}

export async function isBreached(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`HIBP responded ${res.status}`);
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [candidate, count] = line.trim().split(":");
      if (candidate === suffix) return Number(count) > 0;
    }
    return false;
  } catch (e) {
    console.error("[password-policy] Breach check unavailable, failing open:", e instanceof Error ? e.message : e);
    return false;
  }
}
