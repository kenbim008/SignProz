# Secrets & Environment Variables

This document is the inventory of every environment variable used in SignProz, where each one is consumed, and how to rotate it.

## Quick reference

| Variable                       | Used in                                        | Where to get it                                  | Rotation cadence |
|--------------------------------|------------------------------------------------|--------------------------------------------------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL`     | `src/lib/supabase/client.ts`, `server.ts`      | Supabase dashboard → Settings → API              | On compromise    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| `src/lib/supabase/client.ts`, `server.ts`      | Supabase dashboard → Settings → API              | On compromise    |
| `SUPABASE_SERVICE_ROLE_KEY`    | `src/lib/supabase/admin.ts`                    | Supabase dashboard → Settings → API (service role) | On compromise |
| `RESEND_API_KEY`               | `src/app/api/auth/register/start/route.ts`     | https://resend.com/api-keys                      | Annually         |
| `OWNER_EMAIL`                  | `src/lib/email/templates/MagicLinkEmail.tsx`   | The sender address (must be verified in Resend)  | As needed        |
| `NEXT_PUBLIC_APP_URL`          | Magic link generation in `src/lib/utils.ts`    | Local: `http://localhost:3000`; prod: Vercel URL  | As needed        |
| `SENTRY_DSN`                   | `sentry.client.config.ts`, `sentry.server.config.ts` | https://sentry.io → Project Settings → Client Keys | As needed  |

## Detailed rotation steps

### `RESEND_API_KEY`

1. Log in to https://resend.com/api-keys
2. Click "Create API Key"
3. Name it `signproz-prod-2026-06-16` (include the date)
4. Permission: "Sending access"
5. Copy the key (shown once)
6. Update the value in Vercel → Project → Settings → Environment Variables
7. Update `.env.local` for local dev
8. Redeploy Vercel (or wait for next deploy)
9. Run `scripts/rotate-secrets.sh` to log the rotation in git history

### `SUPABASE_SERVICE_ROLE_KEY`

1. Log in to the Supabase dashboard
2. Settings → API → "Service Role" → click "Roll" (or "Generate new key" depending on plan)
3. Copy the new key
4. Update Vercel env var
5. Update `.env.local`
6. Redeploy Vercel

### `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_URL`

These are tied to the Supabase project. Rotating the URL would require migrating all data. To rotate the anon key:

1. Supabase dashboard → Settings → API → "Publishable" key (anon) → "Roll"
2. Update Vercel env var
3. Update `.env.local`
4. Redeploy Vercel

### `SENTRY_DSN`

1. Log in to https://sentry.io
2. Settings → Projects → [project] → Client Keys (DSN)
3. Click "Rotate" or create a new key
4. Update Vercel env var
5. Update `.env.local`
6. Redeploy Vercel

## How to add a new secret

1. Add the variable to `.env.example` (this file is committed)
2. Document it in the table above
3. Read it in code with `process.env.VAR_NAME` (server) or `process.env.NEXT_PUBLIC_VAR_NAME` (client)
4. For client-exposed variables, prefix with `NEXT_PUBLIC_`
5. For server-only secrets, do NOT use the `NEXT_PUBLIC_` prefix
6. Never log the value of a secret in code or in error messages

## Git ignores

`.env*.local` is already in `.gitignore`. Verify with:

```bash
git check-ignore -v .env.local .env.production.local
```

Both should return a `.gitignore` line. If either is not ignored, add it.

## Incident response

If a secret is committed to git or exposed in a screenshot/log:

1. Rotate the secret immediately (steps above)
2. Review git history: `git log -p --all -S "<secret-name>"` (use the secret name, not the value)
3. For `RESEND_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, also check the Resend/Supabase audit logs for unauthorized use
4. If the secret grants production DB write access, treat as a security incident and review `audit_log` entries in Supabase for the relevant time window
