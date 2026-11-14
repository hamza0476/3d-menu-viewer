# Platera

A restaurant workspace and guest-facing interactive menu, built with Next.js App Router, PostgreSQL, Drizzle ORM, and Three.js.

## Included
- Warm, responsive owner dashboard and seeded demo restaurant.
- Secure email/password registration and login using scrypt hashes and HTTP-only sessions.
- Email verification and self-service password reset, both via emailed, single-use, expiring links.
- Rate limiting on login, registration, password reset requests, and verification resends.
- Env-gated admin panel (`/admin`) for platform-wide moderation: restaurant/owner listing and suspend/reinstate.
- Per-restaurant SEO meta and Open Graph tags on public guest menu pages.
- Dietary preference and allergen tagging per dish (6 diet labels + the 14 EU-recognized allergens), with a guest-side filter to avoid allergens or require diet labels, and a local, no-account-needed favorites list.
- Owner-editable menu categories: rename, reorder, add, or delete categories from Settings; renaming cascades to every item in that category, deleting reassigns affected items to a fallback category instead of losing them.
- Deals: bundle 2+ existing menu items into a combo with its own name, price, and photo. Guests open the deal to see everything included, and tapping any bundled item opens that item's own real 3D preview — the same viewer used everywhere else on the menu.
- Strikethrough "original price" on any menu item (deal or not), validated server-side so it can't be set lower than the current price.
- Multi-currency menu pricing (USD, PKR, INR, AUD, EUR, GBP, and Gulf currencies SAR/AED/QAR/KWD/BHD/OMR), formatted per currency for guests and owners.
- Isolated demo workspaces; registration preserves the current demo restaurant and edits.
- Persistent menu CRUD, category/search filters, availability, restaurant details and map.
- Stored photo uploads and guided multi-angle camera capture.
- GLB upload, real-time 3D orbit/zoom, and live camera overlay.
- Public menus with printable QR downloads, guest view tracking, and CSV analytics exports.
- Locally hosted fonts, loading and empty states, optimistic deletions and publication changes with rollback.

## Run

**Prerequisites:** Node.js 20+ and a PostgreSQL database (Docker is the easiest way — see step 2 — or any Postgres you already have).

1. Install dependencies: `npm ci`
2. Start the local database: `docker compose up -d` (creates Postgres 16 on port 5432 with the credentials below; skip this if you use your own Postgres)
3. Configure the environment: `cp .env.example .env` — the defaults match the Docker database. See `.env.example` for every variable the app reads; never commit a real `.env`.
4. Apply the schema: `npm run db:migrate` — versioned migrations from the `drizzle/` folder. (`npm run db:push` exists for throwaway local prototyping only; never use it against a database holding real data, and never edit an already-applied migration — generate a new one with `npm run db:generate`.)
   - **Upgrading a pre-Phase-2 database** (one whose `assets` table still holds base64 `data`): first run `npm run assets:migrate` — it moves every legacy file into storage, verifies each one byte-identical by SHA-256, and writes `asset-migration-report.json`; only then run `npm run db:migrate`, which drops the old column. Migration `0002` refuses to run while unmigrated rows remain, so the bytes cannot be destroyed by running the steps in the wrong order.
5. Start the app: `npm run dev` → http://localhost:3000 — an anonymous visit creates a demo restaurant workspace automatically.
6. Production build: `npm run build` then `npm run start`. In production, set the environment variables in the hosting platform's settings (never in files) and make sure `RESEND_API_KEY` is set so email verification and password resets are really delivered.

Platform choices, account setup steps, and the phased build plan live in `docs/DECISIONS.md` and the master plan kept by the project owner.

### Email (verification + password reset)
Transactional email is sent through [Resend](https://resend.com). Set these to enable real delivery:
- `RESEND_API_KEY` — your Resend API key.
- `EMAIL_FROM` — e.g. `Platera <noreply@yourdomain.com>` (must be a domain verified in Resend).

Without `RESEND_API_KEY`, verification and reset links are logged to the server console instead of emailed, so you can copy the link and test the flow locally without setting up a mail provider. Never leave this unconfigured in production — accounts will be unable to verify or reset without it.

### Admin panel
`/admin` is a platform-moderation view: every restaurant, owner verification status, item/view counts, and a suspend/reinstate control that immediately takes a menu offline for guests (independent of the owner's own publish toggle). It's gated by an allowlist, not a database role — set `ADMIN_EMAILS` to a comma-separated list of the email addresses that should have access (e.g. `ADMIN_EMAILS=you@yourcompany.com,ops@yourcompany.com`). With no `ADMIN_EMAILS` set, `/admin` is inaccessible to everyone.

### Tables, QR codes & analytics
Every restaurant gets a **master QR** plus **one QR per table** (dashboard → *QR codes* → *Tables & print kit*). A printed code encodes only `/m/<code>` — a short random token that resolves server-side to the menu with that table's context — so codes can be deactivated or regenerated without reprinting the rest, and every scan is attributed to its table. Downloads and print layouts (table tent, sticker, counter standee) are rendered server-side at print quality; the print page's *Save as PDF* produces the PDF.

Guest scans, menu opens and dish views are recorded as raw events and folded into daily aggregates by a rollup script. **Schedule it nightly** (it is deliberately a script, not an in-app scheduler), e.g. in cron:

```
15 1 * * *  cd /path/to/platera && npm run analytics:rollup
```

It rolls up yesterday (UTC) by default; `-- --day=YYYY-MM-DD` or `-- --days=N` backfill. Re-running a day is safe — it recomputes that day and can never double-count. The dashboard's Analytics tab reads the aggregates (today is merged live from raw events) and exports CSV from the same data.

### Rate limiting
Login, registration, password-reset requests, and verification resends are rate-limited in memory, per server process. This is enough for a single-instance deployment but resets on restart and is **not shared across multiple instances**. If you deploy behind a load balancer or on serverless with multiple concurrent instances, replace `src/lib/rate-limit.ts` with a shared store (e.g. Upstash Redis, Vercel KV) so limits are enforced consistently.

## Validation
- `npm test` — unit tests (Vitest, `tests/unit/`)
- `npx next typegen`
- `npm exec tsc -- --noEmit --pretty false`
- `npm run build`
- Against a running preview: `node tests/smoke.mjs`

The smoke test requires Chromium and system libraries: `npx playwright install --with-deps chromium`. Override the target URL with `TEST_BASE_URL`.

## 3D scope
Photo capture saves the source images but does **not** reconstruct a photorealistic mesh. For a faithful scan, process the images in an external photogrammetry service and upload its GLB result. Built-in dishes without a GLB use clearly labeled illustrative geometry. Rendering is device-dependent; this app does not claim automatic 4K reconstruction. Camera mode is a manual live-video overlay, not WebXR surface detection or world-anchored AR. Camera access requires HTTPS/localhost and user permission.

## Data and deployment notes
Files are stored as objects in storage (Cloudflare R2, or local disk in development) — the database keeps only asset metadata (storage key, MIME, size, dimensions, SHA-256); it never holds file bytes. QR codes are generated locally in the browser. Assets referenced by a published menu are public for guests; assets of unpublished restaurants are private and reachable only by their owner or via short-lived signed preview URLs. Restaurant maps use Google Maps embeds without an API key. Demo item view counts are explicitly labeled; new guest interactions are tracked separately in recent activity. Menu prices are stored to 2 decimal places even for 3-decimal currencies (KWD, BHD, OMR), rounding for display consistency. Dietary and allergen tags are entered by the restaurant owner and are not independently verified by the platform — the guest menu carries a standing reminder to confirm with staff, which should stay in place for liability reasons in most jurisdictions. Favorites are stored in the guest's own browser (`localStorage`), not the database, so they don't carry across devices and aren't visible to the restaurant. "Deals" is a reserved, built-in category name — it's not stored in the owner-editable categories list and can't be added, renamed into, or deleted; an item is marked as a deal via its own toggle instead. Deleting a menu item that's used inside an existing deal is blocked until that item is removed from the deal first, so a published deal can't silently end up with a missing item. For a large public deployment, add object storage, a shared (multi-instance) rate limit store, database backups, and a dedicated event analytics pipeline.
