#!/usr/bin/env bash
# Runs the PL/pgSQL test file against a local Supabase Postgres instance.
#
# Usage:
#   supabase start          # ensure local Supabase is running
#   ./scripts/test-plpgsql.sh
#
# Environment:
#   TEST_DB_URL  (default: postgres://postgres:postgres@localhost:54322/postgres)

set -euo pipefail

TEST_DB_URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:54322/postgres}"
TEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/tests"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations"

echo "Applying migrations to $TEST_DB_URL..."
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  $(basename "$f")..."
  psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

echo "Running test file..."
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f "$TEST_DIR/00008_legal_evidence.test.sql"

echo ""
echo "All PL/pgSQL tests passed."
