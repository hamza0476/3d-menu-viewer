// Model pipeline worker (Phase 4 — fixes G4).
//
//   npm run models:worker              # process the queue once, then exit
//   npm run models:worker -- --loop    # keep polling every 30 s
//   npm run models:worker -- --loop --interval=10 --limit=3
//
// The worker is a thin driver: the pipeline core (GLB parser, processors,
// storage, AV hook) lives in the app so there is exactly ONE implementation
// of it — this script calls the app's internal worker endpoint with the
// shared secret, the same "plain script, schedule it yourself" shape as
// the Phase 3 analytics rollup. Nothing in the deployment runs this yet:
// schedule it with cron (e.g. every minute) or run --loop under your
// process manager. See docs/DECISIONS.md.
//
// Env: APP_URL (default http://127.0.0.1:3000) — the running app;
//      MODEL_WORKER_SECRET — must match the app's own setting.

const args = process.argv.slice(2);
const loop = args.includes("--loop");
const intervalS = Math.max(1, Number(args.find((a) => a.startsWith("--interval="))?.slice(11) || 30));
const limit = Math.min(20, Math.max(1, Number(args.find((a) => a.startsWith("--limit="))?.slice(8) || 5)));

const appUrl = (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const secret = process.env.MODEL_WORKER_SECRET;
if (!secret) {
  console.error("MODEL_WORKER_SECRET is required (and must match the app's setting)");
  process.exit(2);
}

async function tick() {
  const res = await fetch(`${appUrl}/api/internal/model-worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-model-worker-secret": secret },
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) throw new Error(`worker endpoint responded ${res.status}`);
  const data = await res.json();
  const done = data.outcomes.filter((o) => o.status === "done").length;
  const failed = data.outcomes.filter((o) => o.status === "failed").length;
  console.log(`models worker: processed=${data.processed} done=${done} failed=${failed}`);
  for (const o of data.outcomes) {
    if (o.status === "failed") console.log(`  job ${o.jobId} failed: ${o.error ?? "unknown error"}`);
  }
  return data.processed;
}

if (!loop) {
  await tick().catch((e) => { console.error("models worker FAILED:", e); process.exit(1); });
} else {
  console.log(`models worker: polling ${appUrl} every ${intervalS}s (Ctrl+C to stop)`);
  for (;;) {
    await tick().catch((e) => console.error("models worker tick FAILED:", e.message ?? e));
    await new Promise((r) => setTimeout(r, intervalS * 1000));
  }
}
