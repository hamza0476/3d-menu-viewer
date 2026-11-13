// Pluggable malware-scan hook for uploads (part of the S5 fix).
//
// Phase 2 adds NO scanning engine and NO dependency. The real controls
// that ship today are: magic-byte validation + structural parse
// (media-validation.ts) and quarantine-then-promote storage flow
// (api/assets route). On top of that, this hook lets the operator plug in
// a real scanner (e.g. a ClamAV REST gateway or a cloud scanning service)
// by setting AV_SCAN_URL:
//
//   POST <AV_SCAN_URL>   body: raw file bytes
//                        headers: Content-Type: application/octet-stream,
//                                 X-Filename: <original name>
//   2xx            -> clean, upload proceeds
//   422 (or 403)   -> infected, upload is rejected and the quarantined
//                     object is deleted
//   anything else / network error -> "unavailable": the upload FAILS
//                     CLOSED (503). A scanner the operator configured
//                     must never silently stop scanning.
//
// With AV_SCAN_URL unset the hook reports "skipped" — honest state, not a
// scan. docs/DECISIONS.md records this.

export type ScanResult = { status: "clean" | "infected" | "skipped" | "unavailable"; detail?: string };

export async function scanForMalware(buffer: Buffer, filename: string): Promise<ScanResult> {
  const url = process.env.AV_SCAN_URL;
  if (!url) return { status: "skipped" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Filename": filename },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { status: "clean" };
    if (res.status === 422 || res.status === 403) return { status: "infected", detail: `scanner responded ${res.status}` };
    return { status: "unavailable", detail: `scanner responded ${res.status}` };
  } catch (e) {
    return { status: "unavailable", detail: e instanceof Error ? e.message : String(e) };
  }
}
