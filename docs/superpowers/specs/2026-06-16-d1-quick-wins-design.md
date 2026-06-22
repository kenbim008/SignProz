# D.1 — Quick Wins (Deploy, Secrets, Observability)

**Date:** 2026-06-16
**Status:** Approved Design

---

## Goal

Bridge the gap between "code is correct locally" and "service is healthy in production." This covers deploy coordination, secret rotation, branch workflow, CHANGELOG hygiene, structured logging, and error monitoring.

---

## Section 1: Deploy Coordination

**Problem:** The audit fixes (commits `4d5619d`–`36153fc` on branch `audit/security-remediation`) include database schema changes that must be applied **before** the code deploys, or the app will fail on its first API call.

**Approach:** Create a deploy runbook at `docs/deploy.md` that sequences the work:

1. Apply migrations `00004` and `00005` to production Supabase via SQL Editor
2. Verify with `supabase db diff --linked` (should show no pending changes)
3. Merge PR #2 to `main`
4. Verify Vercel auto-deploys from `main` and passes build
5. Smoke test the auth flow on the production URL
6. Watch Vercel logs and Supabase logs for 30 minutes

**File:** `docs/deploy.md` (new)

---

## Section 2: Secret Rotation

**Problem:** The `RESEND_API_KEY` in `.env.local` was committed to git history in earlier commits (local refs only, but still). Even though we don't push `.env.local`, the key may have been exposed in error logs that ended up in PRs or screenshots.

**Approach:** 
1. Add a one-time command to `scripts/rotate-secrets.sh` that:
   - Generates a placeholder for the README "rotate" section
   - Reminds the user to rotate in their Resend dashboard
2. Add a `SECRETS.md` doc listing every env var, where it's used, and how to rotate each
3. Add `.env*.local` to `.gitignore` (verify it's already there)

**Files:** `scripts/rotate-secrets.sh` (new), `SECRETS.md` (new), `docs/deploy.md` (add rotation step)

---

## Section 3: Branch Workflow Doc

**Problem:** Future audit/feature work shouldn't land directly on `main` (it's protected on GitHub). Contributors need guidance.

**Approach:** Add `CONTRIBUTING.md` with:
- Branch naming: `feature/<short-slug>`, `fix/<short-slug>`, `audit/<date>-<topic>`
- PR template checklist
- Required CI checks: type-check, build, test, lint
- How to apply Supabase migrations (the existing pattern)
- How to push and where to deploy (Vercel auto-deploy from main)

**File:** `CONTRIBUTING.md` (new)

---

## Section 4: CHANGELOG

**Problem:** Users with existing magic-link accounts need to know that auth changed. Without a CHANGELOG, support gets "I can't log in" tickets.

**Approach:** Add `CHANGELOG.md` with a `## [Unreleased]` section. List the audit fix as the first entry:

```markdown
## [Unreleased]

### Security
- **BREAKING**: Replaced custom `sb-session` cookie with Supabase SSR sessions. 
  Magic-link users will need to log in again on next visit.
- HTML content in documents is now sanitized via DOMPurify to prevent stored XSS
- Document signing is now server-enforced (required fields, sequential order)
- Rate limiting added to auth and AI endpoints
- Removed false marketing claims about HIPAA, 400+ integrations, Microsoft 365
- Removed mock Stripe payout UI (replaced with "Coming Soon")
- Resolved schema drift: `profiles.email` populated via trigger, field types expanded
```

**File:** `CHANGELOG.md` (new)

---

## Section 5: Vercel Deploy

**Problem:** The current Vercel deployment is on a stale branch. The audit fixes need to be the live production.

**Approach:** 
1. Verify the `audit/security-remediation` branch has all 24 commits
2. The PR #2 already triggers a Vercel preview — confirm it builds green
3. After merging to `main`, Vercel auto-deploys
4. After deploy, run smoke tests on `https://sign-proz-4xkr.vercel.app/signup`

**Action items:**
- Check Vercel dashboard for the preview URL
- Run `curl -s -o /dev/null -w "%{http_code}" https://sign-proz-4xkr.vercel.app/signup` — expect 200
- Manually click through signup once after deploy to confirm magic link + phone OTP work

---

## Section 6: Structured Logging

**Problem:** Current `console.log`/`console.error` calls produce unstructured text. Hard to search, parse, or alert on.

**Approach:** Replace ad-hoc `console.*` calls in API routes with a thin structured logger that emits JSON to stdout (Vercel captures stdout). Next.js's `request.headers` are captured automatically by Vercel.

**Files:**
- Create `src/lib/logger.ts` — thin wrapper that:
  - Emits `{ level, msg, run_id?, session_id?, path, method, status?, duration_ms?, ...meta }` as JSON
  - Falls back to `console.log(JSON.stringify(obj))`
  - Has `.info()`, `.warn()`, `.error()`, `.debug()` methods
- Update the 8 most-trafficked API routes to use it: `documents/route.ts`, `documents/[id]/route.ts`, `documents/[id]/sign/route.ts`, `auth/callback/route.ts`, `auth/login/route.ts`, `auth/register/start/route.ts`, `auth/session/route.ts`, `agreement-analyze/route.ts`
- Don't log tokens, cookies, or PII

**No new dependency** — keep the implementation in-house to avoid a heavy logger library.

---

## Section 7: Error Monitoring with Sentry

**Problem:** Failed signings, rate-limit triggers, and 5xx errors are silent in production. Without visibility, we can't respond to incidents.

**Approach:** Add `@sentry/nextjs` for error capture. Capture unhandled exceptions in:
- API route handlers
- Server components
- Client component render errors

Capture breadcrumbs for:
- Auth events (login, signup, OTP send)
- Document operations (create, send, sign, complete)

**Files:**
- `package.json` — add `@sentry/nextjs` dependency
- `sentry.client.config.ts`, `sentry.server.config.ts` (Sentry's standard config files)
- `next.config.ts` — wrap with `withSentryConfig()`
- `.env.example` — add `SENTRY_DSN`
- Document setup in `SECRETS.md` (user needs to create a Sentry project and add the DSN)

**Cost:** Sentry has a free tier (5K events/month). Sufficient for current scale.

**Opt-in:** Make `SENTRY_DSN` env var. If empty, the SDK no-ops. This lets the project deploy without Sentry configured.

---

## File Structure

```
docs/
├── deploy.md                  # NEW
SECRETS.md                     # NEW
CONTRIBUTING.md                # NEW
CHANGELOG.md                   # NEW
scripts/
└── rotate-secrets.sh          # NEW
src/lib/
├── logger.ts                  # NEW
sentry.client.config.ts         # NEW
sentry.server.config.ts         # NEW
src/lib/
├── sentry.ts                  # NEW (opt-in helpers)
```

---

## Implementation Order

1. **Migrations applied to production Supabase** (D.1.1 — must be first)
2. `CHANGELOG.md` (D.1.2 — quick win)
3. `docs/deploy.md` (D.1.3)
4. `CONTRIBUTING.md` (D.1.4)
5. `SECRETS.md` (D.1.5)
6. `scripts/rotate-secrets.sh` (D.1.6)
7. `src/lib/logger.ts` + 8 route updates (D.1.7)
8. Vercel deploy verification (D.1.8)
9. Sentry setup (D.1.9)

Each is a small, atomic change with its own commit.

---

## Verification Checklist

- [ ] Migrations `00004` and `00005` applied to production Supabase
- [ ] PR #2 merged to `main`
- [ ] Vercel auto-deploys successfully
- [ ] Smoke test on `https://sign-proz-4xkr.vercel.app/signup` returns 200
- [ ] `CHANGELOG.md` documents the audit fix
- [ ] `CONTRIBUTING.md` defines the workflow
- [ ] `SECRETS.md` lists all env vars
- [ ] `rotate-secrets.sh` runs without errors
- [ ] `src/lib/logger.ts` emits JSON to stdout
- [ ] All major API routes use the logger
- [ ] Sentry SDK installed and configured (DSN optional)

---

## What This Plan Does NOT Cover

- Domain service extraction (D.2 — separate plan)
- Legal evidence model (D.3 — separate plan)
- Migrating to a database-typed schema (later, after D.2)
- Test coverage expansion (later, after D.2)
