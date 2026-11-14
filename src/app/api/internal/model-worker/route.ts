import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { processModelJobs } from '@/lib/model-pipeline';

// Internal worker trigger for the Phase 4 model pipeline.
//
// The pipeline core lives in the app (one implementation of the GLB
// parser, the processors and the storage layer — a standalone script
// would need a second, divergent copy of all three). This route is the
// worker's door: `npm run models:worker` calls it with the shared secret
// from MODEL_WORKER_SECRET. When the secret is not configured the route
// does not exist (404), and a wrong secret is indistinguishable from a
// missing route. It is not reachable by owners or guests — owner actions
// go through /api/models, guests never trigger processing.
export async function POST(req: Request) {
  const secret = process.env.MODEL_WORKER_SECRET;
  if (!secret) return new NextResponse('Not found', { status: 404 });
  const provided = req.headers.get('x-model-worker-secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse('Not found', { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const limit = typeof body.limit === 'number' ? Math.min(Math.max(Math.floor(body.limit), 1), 20) : 5;
  const outcomes = await processModelJobs(limit);
  return NextResponse.json({ processed: outcomes.length, outcomes });
}
