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
