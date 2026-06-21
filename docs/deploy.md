# Deploy Runbook

This document is the source of truth for shipping code to production. Follow these steps in order. **Do not skip the database migration step** — the code requires migrations `00004`, `00005`, `00007`, `00008`, and `00009` to be applied first.

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

### 5. Smoke test the cron endpoints (D.3+)

The three Vercel Cron endpoints require `CRON_SECRET` in `Authorization: Bearer <secret>`.
Use `scripts/smoke-cron.sh` to verify each:

```bash
# Against staging
CRON_SECRET=<your-secret> BASE_URL=https://sign-proz-4xkr.vercel.app ./scripts/smoke-cron.sh

# Against local dev (after `npm run dev`)
CRON_SECRET=<your-secret> BASE_URL=http://localhost:3000 ./scripts/smoke-cron.sh
```

Expected output for each endpoint: HTTP `200` with JSON body containing `ok: true`.
A `401 Unauthorized` means `CRON_SECRET` is not set in the deployment environment.

After the smoke test passes, verify the daily evidence log was appended:

```sql
SELECT log_date, entry_count, jsonb_array_length(leaf_hashes) AS stored_leaves
FROM evidence_log_entries
ORDER BY log_date DESC
LIMIT 1;
```

Expected: a row exists for today's UTC date with `entry_count` matching the count
of completed documents for the day (or `0` if no documents completed today).

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
