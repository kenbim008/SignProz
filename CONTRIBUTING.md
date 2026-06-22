# Contributing to SignProz

Thanks for contributing. This document covers the workflow we follow on this project.

## Branch naming

All work happens on a feature branch off `main`. Use one of these prefixes:

| Prefix       | Use for                                        | Example                              |
|--------------|------------------------------------------------|--------------------------------------|
| `feature/`   | New user-facing functionality                  | `feature/ai-clause-extraction`       |
| `fix/`       | Bug fixes                                      | `fix/registration-otp-replay`        |
| `audit/`     | Time-boxed audit or hardening work             | `audit/2026-06-16-security-remediation` |
| `chore/`     | Tooling, deps, non-functional changes          | `chore/upgrade-next-16`              |
| `docs/`      | Documentation-only changes                     | `docs/deploy-runbook`                |

Keep the slug short (2-4 words), lowercase, hyphenated.

## Pull request workflow

1. Branch off `main`: `git checkout -b <prefix>/<slug> main`
2. Make small, atomic commits (one logical change per commit)
3. Push the branch: `git push -u origin <branch>`
4. Open a PR against `main`
5. Fill in the PR description (see template below)
6. Wait for CI to pass — required checks:
   - `type-check` (`npx tsc --noEmit`)
   - `build` (`npm run build`)
   - `test` (`npm test`)
   - `lint` (`npx eslint .`)
7. Address review feedback with fixup commits or `git commit --fixup=`
8. Squash-merge once approved (the PR author merges)

## PR description template

```markdown
## What

<1-3 sentences>

## Why

<Link to issue, audit finding, or user story>

## How

<Brief technical summary. Reference key files with `path:line` notation.>

## Testing

<How did you verify? New tests added? Manual steps?>

## Risk

<Migration required? Feature flag? Backwards-compatible?>

## CHANGELOG

<Did you add an entry under [Unreleased]?>
```

## Database migrations

When your change requires schema changes:

1. Create a new file in `supabase/migrations/` named `NNNNN_short_description.sql` (increment the number)
2. Use `IF NOT EXISTS` on `CREATE TABLE` / `CREATE INDEX` (Postgres 15+)
3. Do not use `IF NOT EXISTS` on `ADD CONSTRAINT` (Postgres 15 limitation) — wrap in `DO $$ ... $$` or use `DROP CONSTRAINT IF EXISTS` followed by `ADD CONSTRAINT`
4. Add RLS policies for any new tables
5. Test against the linked remote: `supabase db reset --linked` (this wipes data — coordinate first)
6. Document the migration in the PR description under "Risk"
7. **The deploy runbook** (`docs/deploy.md`) **must be followed** — migrations apply BEFORE code deploys

## Environment setup

See `SECRETS.md` for the full env var inventory. Quick start:

```bash
cp .env.example .env.local  # if .env.example exists; otherwise see SECRETS.md
npm install
npm run dev
```

## Code style

- TypeScript strict mode is on — no `any` outside tests
- Match the comment density of surrounding code
- One responsibility per file
- Use the existing `src/lib/validation.ts` Zod schemas for request bodies
- Use the existing `src/lib/auth.ts` `getSession()` for auth checks (no custom cookies)

## Don'ts

- Don't commit `.env*.local` files
- Don't push directly to `main` (branch protection is on)
- Don't force-push to rewrite review feedback history
- Don't add a new logging library — use `src/lib/logger.ts` (added in D.1)
- Don't add a new state library without a plan in the project tracker

## Releases

We use the [Keep a Changelog](https://keepachangelog.com/) format in `CHANGELOG.md`. Each merged PR should add an entry under `## [Unreleased]`. When cutting a release, move entries under a new dated heading.
