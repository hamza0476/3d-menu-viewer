# Platera — Platform Decisions & Setup Checklist

Recorded at Phase 0 (2026-11-04). These are the working defaults from the master build plan. Anything marked **provisional** stands until the project owner explicitly changes it — changing a provisional item later is fine, but record the change here.

## Platform choices (provisional)

| Concern | Choice | Why |
|---|---|---|
| App hosting | **Vercel** | Native Next.js hosting, preview deployment per pull request, instant rollback |
| Database | **Neon** (PostgreSQL) | Serverless Postgres, branching, point-in-time recovery; `DATABASE_URL` in env only |
| File storage (Phase 2) | **Cloudflare R2** + Cloudflare CDN | Zero egress fees — critical when every guest loads MBs of 3D models |
| Rate limits / jobs (Phase 1+) | **Upstash** (Redis + QStash) | Serverless Redis; replaces the in-memory rate limiter |
| Email | **Resend** (already integrated) | Verification + password reset; sending domain must be verified (SPF/DKIM) before launch |
| Error tracking (Phase 1+) | **Sentry** free tier | No observability exists yet |
| Product name | **Platera** (kept) | It is in the code, logo and copy; renaming gets more expensive every phase |
| Domain | **Not decided yet** | Needed before pilot launch: app domain + `cdn.` subdomain + short menu links. Owner action. |
| Billing (Phase 7) | **Deferred** | Stripe does not onboard Pakistan-based businesses. Candidates: Paddle / Lemon Squeezy (merchant of record) and/or manual JazzCash/Easypaisa activation for local pilots. |
| Reservations / ordering | **Phase 8 modules** | The book-style menu is the core product; table reservations, call-waiter and ordering are designed add-ons, built only on the owner's command. |

Indicative pilot cost at this stack: roughly **$25–60/month** total.

## Environment variables

Every variable the code reads is documented in `.env.example`. Rules:

- Real values live only in `.env` (local, git-ignored) or the hosting platform's environment settings (production).
- No secret is ever committed, pasted into chat, or put in a file in this repo.

## Known baseline debt (recorded, not hidden)

**Lint:** at Phase 0 the repo had **21 pre-existing ESLint errors + 11 warnings** on an untouched `main` (7 `react/no-unescaped-entities`, 6 `@next/next/no-html-link-for-pages`, 6 `react-hooks/set-state-in-effect`, 2 `react-hooks/purity`; warnings are all `@next/next/no-img-element`). CI therefore runs lint as a **non-blocking** job (`lint-baseline`) so the debt stays visible. Fixing the react-hooks findings touches component behaviour, so it is scheduled as its own dedicated change with its own tests — when it lands, `continue-on-error` comes out of `.github/workflows/ci.yml` and lint becomes a hard gate.

**Schema management:** the schema is still applied with `drizzle-kit push` for local development only. Versioned migrations arrive in Phase 1; `push` must never be run against a database holding real customer data.

## Phase 2 — media & storage decisions (2026-11-13)

- **Storage backend:** `src/lib/storage.ts` abstracts object storage. With `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` all set, files go to **Cloudflare R2** via its S3 endpoint, signed by hand with AWS SigV4 (node crypto only — **no SDK dependency**, mirroring Phase 1's hand-rolled Upstash REST). With any of them unset, files go to **local disk** (`ASSET_STORAGE_DIR`, default `./.storage`) so development and the full test suite need no Cloudflare account. The Cloudflare account itself remains an owner-only step (see the accounts table below).
- **One bucket, key-prefix separation (for now):** the plan sketched separate private/public buckets. Phase 2 ships a single bucket with access enforced at the app layer (the serving route, not the bucket, decides public vs private — see S6 below), because assets change visibility as a restaurant publishes/unpublishes, and an object's bucket cannot change with a database flag. When the `cdn.` domain lands, published assets can be exposed through the CDN without moving private sources. Quarantined uploads live under the `quarantine/` prefix, promoted files under `assets/`.
- **Upload validation (S5) — what is real vs hooked:**
  - *Real, in code:* magic-byte sniffing for JPEG/PNG/WebP/GLB (the client's MIME/extension is ignored), structural GLB check (version 2 + declared length == actual), image structural parse to real dimensions (corrupt/truncated rejected), 20 MB cap, sha256 recorded per asset, quarantine-then-promote flow.
  - *Hooked, not built in:* malware scanning. `AV_SCAN_URL` plugs in an external scanner (POST raw bytes; 2xx clean, 422/403 infected, anything else fails the upload closed with 503). With it unset, **no AV scan happens** — that is stated plainly, not hidden.
  - *Not done, deliberately:* image **re-encoding**. Node has no built-in image codec and Phase 2 adds no dependencies, so pixel re-encode (the strongest strip-the-payload defence) is not possible in this codebase today. The residual risk is bounded: only three raster formats pass the sniff+parse gate, files are served with their sniffed (not claimed) MIME plus `nosniff`, and SVG/HTML/GIF polyglots are rejected outright. Revisit if/when an image library is adopted for the Phase 4 poster pipeline.
- **Access control (S6):** an asset is public only while referenced by an item of a published, non-suspended restaurant. Otherwise it needs the owner's session or a 5-minute HMAC-signed URL minted by the owner-only `/api/assets/[id]/preview` redirect. Public responses keep the long immutable cache; private/signed responses are `private, no-store`. Production must set `ASSET_SIGNING_SECRET` (the dev fallback derives it from `DATABASE_URL`).
- **Legacy data:** migration `0001` adds the metadata columns (idempotent SQL, so the migration tool can apply it directly); `scripts/migrate-assets-to-storage.mjs` moves base64 bytes to storage with per-file sha256 before/after verification and a JSON report; migration `0002` drops `assets.data` and **aborts if any row is still unmigrated**, so running steps in the wrong order cannot destroy bytes. Note drizzle-kit applies pending migrations in one transaction, which is exactly why the tool — not `db:migrate` — applies 0001 on legacy databases.

## Phase 3 — QR, tables & analytics decisions (2026-11-13)

- **One event table, not two:** the plan sketched `scan_events` + `view_events`; Phase 3 ships a single append-only `guest_events` (type ∈ scan/menu_open/item_view, `3d_open` reserved for the Phase 4 viewer) plus `analytics_daily` rollups exactly as designed. Fewer tables, same questions answerable.
- **Codes:** a QR's printed token is 12 chars from a 31-char unambiguous alphabet (≈59 bits), generated with rejection sampling. The token — never the menu URL — is printed, so it can be re-pointed, deactivated or regenerated server-side. Restaurants are still addressed by id in `/menu/<id>`; public slugs from the plan remain future work and the `?t=<code>` parameter carries table context.
- **QR dependency decision:** the `qrcode` package was **already a dependency** (the old UI used it client-side), so server-side rendering added **no runtime dependency**. Two **dev-only** dependencies were added for tests — `jsqr` + `pngjs` — so the integration suite can decode the server-rendered PNG and prove it encodes the right URL (the Phase 3 acceptance asks for exactly this). They ship nowhere near production code.
- **Privacy:** events store no IPs, no user-agent strings, no fingerprints — only a device class (mobile/tablet/desktop) and the SHA-256 hash of a per-browser-session anonymous id that exists solely for 60-second de-duplication.
- **Spam control (S12):** the public event endpoint is layered — per-connection rate limits (120 item events/min, 30 menu opens/min, via the Phase 1 limiter) plus per-session de-duplication. `products.views` and the activity feed advance only for events that pass both, so counters can no longer be inflated by replay.
- **Rollup scheduling:** `scripts/rollup-analytics.mjs` is a plain script (cron line in the README), **not** an in-app scheduler — nothing in the deployment runs it yet. Day boundaries are **UTC** and the database is expected to run in UTC (Neon's default). Per-restaurant timezones are a Phase 6 concern.
- **Print/PDF:** the print kit is a server-rendered page (tent/sticker/standee); the PDF is produced by the browser's Print → Save as PDF. The rendered PNG is stored as a `qr-print` asset per Phase 2's storage rules.
- **Lint:** the repo now measures **19 errors / 10 warnings** — the rebuilt Analytics tab removed the old tab's two render-time `Date.now()` purity errors and one `<img>` warning. Nothing new was added; the remaining debt is unchanged and CI's lint job stays non-blocking.

## Phase 4 — 3D pipeline & viewer decisions (2026-11-14)

- **Tracking + queue (migration `0004`):** `item_models` holds one row per dish — status (`none/queued/processing/ready/failed`), source/high/low/USDZ/poster asset links, byte counts before/after, parsed triangle/texture counts, the processor label, per-enhancement statuses and the failure reason. `model_jobs` is the DB-backed queue: claims are a single atomic UPDATE of the oldest queued row (two workers can never take the same job), a `processing` job older than 15 minutes is reclaimable (crashed worker), and failures increment attempts without poisoning the queue. Model removal clears the tracking row to `none`; a model change re-queues.
- **Worker shape:** the pipeline lives in `src/lib/model-pipeline.ts` inside the app (it needs the DB, storage and AV hook), exposed as `POST /api/internal/model-worker` gated by `MODEL_WORKER_SECRET` — an unset or wrong secret gets a **404**, not a 401, so the endpoint does not advertise itself. `npm run models:worker` (`scripts/process-models.mjs`) is a deliberately thin CLI that calls that endpoint (`--loop` polls). Like the Phase 3 rollup it is a **script an operator schedules** (cron line in the README); nothing in the deployment runs it yet, and the Studio UI says "Queued" honestly instead of spinning forever.
- **Deep GLB gate:** `src/lib/glb.ts` parses the container properly — chunk walk, JSON parse, buffers/bufferViews/accessor cross-validation, triangle/vertex counts from accessor counts (never file size), embedded texture bytes, external-reference rejection, and a 5,000,000-triangle cap. It extends, not replaces, Phase 2's upload sniff (which still rejects truncated/wrong-format files at upload). A corrupt GLB fails **the job** with the parser's reason; the worker continues with the next job (proven in the integration suite).
- **Processors are pluggable; the default is honestly "passthrough":** no GLB optimiser (gltfpack/gltf-transform/Blender/KTX2) exists in this environment, and adding one means heavy new dependencies. So the optimisation step is an adapter: set `MODEL_OPTIMIZER_CMD` (optionally `_HIGH_CMD`/`_LOW_CMD`) to a command template with `{in}`/`{out}` placeholders and the pipeline runs it as an external process, **re-parses its output as a GLB before storing it**, and labels the row `external:<tool>`. Unset, the worker stores faithful copies of the source as the high/low variants and labels the row `processor='passthrough'` — in the Studio UI and the quality report that is worded "unoptimised copies", and the optimisation grade is capped at "ok" so nothing pretends a transcode happened. The integration suite proves the adapter path with a real external command that transforms the file (output bytes differ, still a valid GLB).
- **USDZ:** no converter is present or installable here without heavy deps, so USDZ is adapter-only (`MODEL_USDZ_CMD`). Unset → `usdzStatus='not-configured'`, shown as such in the Studio; the viewer only offers iOS Quick Look when a real USDZ asset exists. A converter failure marks USDZ failed and leaves the GLB variants ready.
- **Poster capture is real:** `scripts/render-poster.mjs` renders the GLB headlessly (Chromium via Playwright — already a devDependency for the smoke tests) on the viewer's own stage/lighting, framed from the model's bounding sphere, and writes a 640×640 PNG. It runs only when `MODEL_POSTER_CMD="node scripts/render-poster.mjs {in} {out}"` is set; deployment needs `npx playwright install chromium`. Verified end-to-end in this environment, including inside the integration suite. Any other renderer command can be configured the same way.
- **`@google/model-viewer` was evaluated and REJECTED — zero new dependencies again:** every published version (checked up to v4.4.0) peer-pins `three` to ≤0.183 while this repo runs ^0.186, so installing it means downgrading three or forcing a duplicate three copy (the classic two-threes breakage). The progressive viewer was therefore hand-rolled on the existing three.js stack delivering the same semantics: poster first paint → low variant interactive → high variant preloaded and swapped in (skipped on slow/save-data connections, offered via a "High quality" button), AR only where real (Quick Look via the USDZ when present; WebXR `immersive-ar` on the same renderer with viewer-space fallback), and the pre-Phase-4 viewer retained untouched as the failure fallback.
- **Quality grades are computed, never estimated:** `src/lib/model-quality.ts` grades measured values only (triangle count, low-variant bytes, texture bytes, variant presence) with good/ok/poor per check; the Studio shows the numbers next to the grades.
- **Events:** dish 3D opens post `type: '3d_open'` into the Phase 3 `guest_events` pipeline (same rate limits and 60-second de-duplication) and deliberately do **not** increment the views counter, matching how the plan reserves the type.
- **Variant access** extends the Phase 2 published rule: high/low/USDZ/poster of a `ready` item are public exactly while the item's restaurant is published and not suspended; unpublishing revokes them (suite-proven). Lint unchanged at **19 errors / 10 warnings**.

## Phase 5 — The Book Menu (fixes G1)

- **The flip is hand-rolled — page-flip libraries were evaluated and rejected:** `react-pageflip` wraps the unmaintained `page-flip` package (no React 19 / current-Next assurance, imperative page-count API fights the category-chapter model, and it renders its own DOM that would fight the sheet/viewer modals), and CSS-framework flip snippets provide no keyboard/swipe/chapter semantics. The book is therefore a small hand-rolled CSS-3D flip (`src/components/book-menu.tsx`): one sheet per spread, a 470ms rotateY turn with an under-sheet, tap/swipe/keyboard/button navigation, and a thumb index (chapters rail on wide screens, chips on narrow). Chapters follow the owner's category order (Deals first); spreads hold 4 dishes (`BOOK_SPREAD_SIZE` in `src/lib/guest-book.ts`, the single knob); a dish can never be lost or duplicated by pagination — unit-tested.
- **The book never gates content:** server render and first paint are the *stacked* book (every spread, readable with no JS, no WebGL, no animation). The animated stage takes over after mount. View resolution (`resolveGuestView`, unit-tested): a stored choice wins; stored `book` + `prefers-reduced-motion` → the non-animated stacked book; no stored choice + reduced motion → the classic list; low-end signals (Save-Data, ≤2GB device memory, ≤2 cores) → stacked book, never the animated flip.
- **Event semantics in the book (documented divergence):** the list view fires `item_view` when a dish opens the combined modal (which immediately mounts the 3D entry). The book fires `item_view` when the dish detail sheet opens, and `3d_open` only when the guest actually taps through to 3D — the Phase 4 meaning of the event. Owners comparing phases should read `3d_open` as "real 3D intent" from Phase 5 on.
- **Dish detail sheet** holds the full data (photos, description, price/deals, diet tags, allergens + the existing disclaimer) and reuses the Phase 4 viewer unchanged as its 3D entry; the honest "illustrative preview" label for model-less dishes is preserved.
- **Urdu scope boundary (read before Phase 6):** the guest chrome ships a full EN/UR dictionary (`src/lib/guest-i18n.ts`, key-parity unit-tested) with correct RTL for the chrome and `dir="auto"` on owner-entered text (names, descriptions, categories). The schema has **no** Urdu content fields anywhere — dish/category Urdu names are Phase 6 dashboard work and were deliberately NOT built here. Owner data renders in the language the owner typed it.
- **Branding:** the book cover uses the owner's Phase 2 `logo`/`cover` assets. That required one access-rule extension: logo/cover assets of a published, non-suspended business are public (same published rule as dish media; unpublishing revokes them — suite-proven). The menu payload gained a `branding` field with the resolved URLs.
- **PWA + caching:** the manifest is per-restaurant (`/menu/<id>/manifest.webmanifest` — name, start_url and scope are the restaurant's own page; the icon is the uploaded logo, and when no logo exists the icons array is honestly empty rather than a fabricated default). `public/sw.js` (version `platera-sw-v1`, bump on strategy changes) does stale-while-revalidate for `GET /api/menu/*`, network-first with cache fallback for `/menu/*` navigations, and cache-first for hashed statics; `/sw.js` itself is served `must-revalidate` so guests never pin a stale shell. The menu payload sends `s-maxage=60, stale-while-revalidate=300` with a sha256 ETag and 304 revalidation (a 12-item demo menu measures **6,216 bytes** JSON). Known limit: the offline fallback is the last-cached page/payload pair — a first-ever visit still needs the network, and the SW only registers from menu pages.
- **What stayed identical:** the classic list/grid is the same component tree behind the toggle (SEO/OG metadata byte-identical, QR section and favourites included); the Phase 3 table banner and event pipeline are unchanged; Phase 2 asset rules are unchanged except the branding extension above. No DB migration, no new dependencies. Lint stays at the Phase 3/4 level: **19 errors / 10 warnings**, zero new findings.

## Owner-only setup steps (cannot be done from code)

### GitHub repository settings
Do these in github.com → `hamza0476/3d-menu-viewer` → Settings:

1. **Now:** Settings → Code security → enable **Secret scanning** and **Push protection** (free on public repos). Dependabot config already ships in this repo (`.github/dependabot.yml`); also enable **Dependabot alerts** on the same page.
2. **After the Phase 0 pull request is merged** (the CI check name must exist first): Settings → Branches → Add rule for `main`:
   - Require a pull request before merging
   - Require status checks to pass → select **"Typecheck, unit tests, build"**
   - Block force pushes

### Accounts to create (owner's own email/payment details)
Create when the corresponding phase starts — no need to pre-create everything:

| When | Account | What to take from it |
|---|---|---|
| Before first deploy | Vercel | Import this repo; set the env vars from `.env.example` in Project Settings → Environment Variables |
| Before first deploy | Neon | Create project + database; copy its pooled connection string into `DATABASE_URL` (Vercel + local `.env`) |
| Phase 2 | Cloudflare | One R2 bucket; put account id + access keys + bucket name into `R2_*` env vars, and set a dedicated `ASSET_SIGNING_SECRET`. `cdn.` subdomain comes with the launch domain |
| Phase 1 | Upstash | Redis database; URL/token go into env when the Redis rate limiter lands |
| Before launch | Resend | Verify the sending domain (SPF/DKIM records) so verification emails are not spam-foldered |

**Never send passwords, API keys or connection strings in chat.** Paste them directly into the platform's own settings pages.
