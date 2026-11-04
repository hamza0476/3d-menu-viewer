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
| Phase 2 | Cloudflare | R2 buckets (private source + public CDN) and a `cdn.` subdomain |
| Phase 1 | Upstash | Redis database; URL/token go into env when the Redis rate limiter lands |
| Before launch | Resend | Verify the sending domain (SPF/DKIM records) so verification emails are not spam-foldered |

**Never send passwords, API keys or connection strings in chat.** Paste them directly into the platform's own settings pages.
