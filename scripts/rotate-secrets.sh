#!/usr/bin/env bash
#
# rotate-secrets.sh — record a secret rotation event
#
# This script does NOT have access to your secrets. It writes a dated marker
# to the git history so rotations are auditable. The actual rotation must be
# done in each provider's dashboard (see SECRETS.md).
#
# Usage:
#   ./scripts/rotate-secrets.sh resend
#   ./scripts/rotate-secrets.sh supabase-service-role
#   ./scripts/rotate-secrets.sh sentry
#

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <secret-name>"
  echo ""
  echo "Valid secret names:"
  echo "  resend                    — Resend API key"
  echo "  supabase-service-role     — Supabase service role key"
  echo "  supabase-anon             — Supabase anon key"
  echo "  sentry                    — Sentry DSN"
  echo "  custom:<name>             — any other secret"
  exit 1
fi

SECRET_NAME="$1"
ROTATION_DATE="$(date -u +%Y-%m-%d)"

case "$SECRET_NAME" in
  resend)
    REMINDER="Rotate at: https://resend.com/api-keys"
    ;;
  supabase-service-role)
    REMINDER="Rotate at: Supabase dashboard → Settings → API → Service Role"
    ;;
  supabase-anon)
    REMINDER="Rotate at: Supabase dashboard → Settings → API → Publishable key"
    ;;
  sentry)
    REMINDER="Rotate at: https://sentry.io → Project Settings → Client Keys"
    ;;
  custom:*)
    REMINDER="Custom secret — update in your provider's dashboard"
    ;;
  *)
    echo "Unknown secret name: $SECRET_NAME"
    echo "Use one of: resend | supabase-service-role | supabase-anon | sentry | custom:<name>"
    exit 1
    ;;
esac

echo ""
echo "Recording rotation marker for: $SECRET_NAME"
echo "Date: $ROTATION_DATE"
echo "Action: $REMINDER"
echo ""
echo "After rotating in the dashboard:"
echo "  1. Update Vercel env var: https://vercel.com/<project>/settings/environment-variables"
echo "  2. Update .env.local for local dev"
echo "  3. Trigger a Vercel redeploy (or wait for next push)"
echo ""

MARKER_FILE=".secret-rotations.log"
printf "%s\t%s\t%s\n" "$ROTATION_DATE" "$SECRET_NAME" "$REMINDER" >> "$MARKER_FILE"

git add "$MARKER_FILE"
git commit -m "chore(security): rotate $SECRET_NAME on $ROTATION_DATE"

echo "Committed rotation marker. See $MARKER_FILE for history."
