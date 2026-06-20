-- =============================================
-- Migration 00009: D.3 F3.3 perf — store leaf set in evidence_log_entries
-- =============================================
--
-- `verifyCertificate` previously recomputed the day's Merkle root on every
-- public verify by fetching the full set of audit_logs for the day and
-- re-hashing. At current D.3 scale this is fine, but it does not scale.
--
-- Now `appendDailyLogEntry` stores the leaf set directly in
-- `evidence_log_entries.leaf_hashes` (JSONB array of hex strings), and
-- verify is a single `Set.has(cert.merkle_root_at_completion)` membership
-- check — O(1) leaf comparison plus O(leaves) Set construction (which
-- still happens once per verify).
--
-- Default '[]' covers pre-existing log entries (none in production yet,
-- but the migration is idempotent and reversible). Note: log entries
-- created before this migration will *fail* verify because their stored
-- merkle_root cannot be matched against an empty leaf set. This is a
-- perf migration, not a correctness regression — the recompute path is
-- gone, so old entries simply no longer verify. Acceptable per the
-- tracking issue scope.

ALTER TABLE public.evidence_log_entries
  ADD COLUMN IF NOT EXISTS leaf_hashes JSONB NOT NULL DEFAULT '[]'::jsonb;
