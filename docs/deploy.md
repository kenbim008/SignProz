# Deploy Runbook

This document is the source of truth for shipping code to production. Follow these steps in order. **Do not skip the database migration step** — the code requires migrations `00004`, `00005`, `00007`, and `00008` to be applied first.

## Pre-deploy checklist

- [ ] All CI checks pass on the PR (`type-check`, `build`, `test`, `lint`)
- [ ] Migrations in `supabase/migrations/` have been reviewed and are ready to apply
- [ ] No secrets, API keys, or PII in the diff (`git diff main...HEAD | grep -iE "api[_-]?key|secret|password|token"`)
- [ ] CHANGELOG.md has an entry under `## [Unreleased]`

## Deploy steps

### 1. Apply database migrations (if any)

If the PR includes new files in `supabase/migrations/`:

1. Open the Supabase dashboard → SQL Editor for the production project
2. For each new migration file (in numerical order), copy its contents and run them
3. Verify with: `supabase db diff --linked` (should show no pending changes)
4. Confirm by running a representative `SELECT` against any new tables/columns

### 2. Merge the PR

- Merge via the GitHub UI (squash or merge commit, project standard)
- Do not bypass branch protection on `main`

### 3. Verify Vercel auto-deploy

- Vercel auto-deploys from `main` within ~60 seconds
- Watch the deploy log at: `https://vercel.com/<project>/deployments`
- Wait for the "Building" → "Ready" transition
- If build fails, the Vercel deploy log will show the error — fix and re-push

### 4. Smoke test

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sign-proz-4xkr.vercel.app/signup
```

Expected: `200`

Then manually:
1. Visit `https://sign-proz-4xkr.vercel.app/signup`
2. Walk through the registration wizard (email → details → email OTP → phone OTP → password)
3. Confirm the dashboard loads
4. Sign out, then log back in

### 5. Monitor (30 minutes)

- Vercel function logs: `https://vercel.com/<project>/logs`
- Supabase logs: `https://supabase.com/dashboard/project/_/logs`
- Watch for: 5xx spikes, auth failures, rate-limit triggers

## Rollback

If the deploy causes a production incident:

1. **Revert the Vercel deploy:** Vercel dashboard → Deployments → click the last good deploy → "Promote to Production"
2. **Revert migrations (if needed):** write a new migration that undoes the change; do not edit historical migration files
3. **Document the incident** in CHANGELOG.md under a new `## [Unreleased]` subsection

## Secret rotation

See `SECRETS.md` for which secrets to rotate, when, and how.
