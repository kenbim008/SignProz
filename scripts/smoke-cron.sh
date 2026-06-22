#!/usr/bin/env bash
# smoke-cron.sh — verify the three Vercel Cron endpoints respond 200 with auth.
#
# The endpoints:
#   GET  /api/cron/daily-evidence-log    — append today's transparency log entry
#   POST /api/cron/backfill-timestamps   — retry missing TSA tokens
#   POST /api/cron/retry-phase-a         — retry missing PDF blob uploads
#
# All three require Authorization: Bearer $CRON_SECRET.
#
# Usage:
#   CRON_SECRET=<secret> BASE_URL=https://sign-proz-4xkr.vercel.app ./scripts/smoke-cron.sh
#   CRON_SECRET=<secret> BASE_URL=http://localhost:3000 ./scripts/smoke-cron.sh
#
# Exit codes:
#   0 — all three endpoints returned 200
#   1 — at least one endpoint failed

set -euo pipefail

CRON_SECRET="${CRON_SECRET:-}"
BASE_URL="${BASE_URL:-http://localhost:3000}"

if [ -z "$CRON_SECRET" ]; then
  echo "Error: CRON_SECRET environment variable is required." >&2
  echo "" >&2
  echo "Usage: CRON_SECRET=<secret> BASE_URL=<url> $0" >&2
  exit 1
fi

# Strip trailing slash from BASE_URL
BASE_URL="${BASE_URL%/}"

failed=0

hit() {
  local method="$1"
  local path="$2"
  local label="$3"

  local response
  response=$(curl -sS -w "\n%{http_code}" \
    -X "$method" \
    -H "Authorization: Bearer $CRON_SECRET" \
    "${BASE_URL}${path}" 2>&1) || {
    echo "✗ $label: curl failed"
    echo "  $response"
    failed=1
    return
  }

  local body
  local code
  body=$(echo "$response" | head -n -1)
  code=$(echo "$response" | tail -n 1)

  if [ "$code" = "200" ]; then
    echo "✓ $label: 200 — $body"
  else
    echo "✗ $label: $code — $body"
    failed=1
  fi
}

# 1. Daily evidence log (GET)
hit GET "/api/cron/daily-evidence-log" "daily-evidence-log"

# 2. Backfill timestamps (POST)
hit POST "/api/cron/backfill-timestamps" "backfill-timestamps"

# 3. Retry Phase A (POST)
hit POST "/api/cron/retry-phase-a" "retry-phase-a"

echo ""
if [ $failed -eq 0 ]; then
  echo "All cron endpoints OK."
  exit 0
else
  echo "One or more cron endpoints failed."
  exit 1
fi
