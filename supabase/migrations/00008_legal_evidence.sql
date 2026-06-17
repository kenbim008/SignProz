-- =============================================
-- SignProz Database Schema
-- Migration 00008: D.3 Legal Evidence Model
-- Part 1: audit_logs hash chain
-- =============================================

-- pgcrypto is required for digest() (SHA-256)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Idempotent cleanup — drop triggers in alphabetical order
DROP TRIGGER IF EXISTS audit_logs_00_verify_js_hash ON public.audit_logs;
DROP TRIGGER IF EXISTS audit_logs_01_compute_hash ON public.audit_logs;

-- Add chain columns to audit_logs
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS prev_hash BYTEA,
  ADD COLUMN IF NOT EXISTS hash BYTEA,
  ADD COLUMN IF NOT EXISTS chain_key TEXT GENERATED ALWAYS AS (document_id::text) STORED;

-- canonical_audit_json: stable JSON text for hashing.
-- Produces alphabetically-sorted keys matching the JS canonicalizeAuditRow
-- (src/lib/canonicalize.ts). Timestamps are truncated to millisecond
-- precision and formatted as ISO 8601 UTC, matching JS toISOString()
-- when the JS side also floors to ms.
CREATE OR REPLACE FUNCTION public.canonical_audit_json(p_row public.audit_logs)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_json JSONB;
  v_key TEXT;
  v_parts TEXT[] := '{}';
  v_sorted_keys TEXT[];
BEGIN
  v_json := to_jsonb(p_row);
  -- Exclude chain pointer fields and generated column
  v_json := v_json - 'prev_hash' - 'hash' - 'chain_key';
  -- Normalize timestamps: truncate to milliseconds, format as ISO 8601 UTC
  -- date_trunc floors (truncates), matching JS's toISOString() when JS also floors
  IF v_json ? 'created_at' THEN
    v_json := jsonb_set(v_json, '{created_at}',
      to_jsonb(to_char(date_trunc('milliseconds', (v_json->>'created_at')::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  END IF;
  IF v_json ? 'updated_at' THEN
    v_json := jsonb_set(v_json, '{updated_at}',
      to_jsonb(to_char(date_trunc('milliseconds', (v_json->>'updated_at')::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  END IF;
  -- Build sorted-keys JSON text (alphabetical, matching JS stableStringify)
  SELECT jsonb_object_agg(key, value ORDER BY key)
  INTO v_json
  FROM jsonb_each(v_json);
  RETURN v_json::text;
END;
$$;

-- compute_audit_hash: sets prev_hash and computes SHA-256(prev_hash || canonical_json).
CREATE OR REPLACE FUNCTION public.compute_audit_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_hash BYTEA;
  v_canonical TEXT;
BEGIN
  -- Look up the previous hash in this document's chain
  SELECT hash INTO v_prev_hash
  FROM public.audit_logs
  WHERE document_id = NEW.document_id
    AND id <> NEW.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.prev_hash := v_prev_hash;

  v_canonical := public.canonical_audit_json(NEW);

  IF v_prev_hash IS NULL THEN
    NEW.hash := digest(v_canonical, 'sha256');
  ELSE
    NEW.hash := digest(v_prev_hash || convert_to(v_canonical, 'UTF8'), 'sha256');
  END IF;

  RETURN NEW;
END;
$$;

-- verify_audit_hash: if NEW.hash is set (JS layer pre-computed), verify it matches.
-- Named 00_verif so it sorts BEFORE 01_compute — PostgreSQL fires BEFORE INSERT
-- triggers in alphabetical order by trigger name. This lets verify check the
-- JS-supplied hash before compute overwrites it.
CREATE OR REPLACE FUNCTION public.verify_audit_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_hash BYTEA;
  v_canonical TEXT;
  v_expected BYTEA;
BEGIN
  SELECT hash INTO v_prev_hash
  FROM public.audit_logs
  WHERE document_id = NEW.document_id
    AND id <> NEW.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  v_canonical := public.canonical_audit_json(NEW);

  IF v_prev_hash IS NULL THEN
    v_expected := digest(v_canonical, 'sha256');
  ELSE
    v_expected := digest(v_prev_hash || convert_to(v_canonical, 'UTF8'), 'sha256');
  END IF;

  IF NEW.hash IS NOT NULL AND NEW.hash <> v_expected THEN
    RAISE EXCEPTION 'HASH_MISMATCH' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 00_verify fires first (alphabetical) to check JS-supplied hash
CREATE TRIGGER audit_logs_00_verify_js_hash
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.verify_audit_hash();

-- 01_compute fires second and sets the final prev_hash + hash
CREATE TRIGGER audit_logs_01_compute_hash
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.compute_audit_hash();

-- Index for chain lookups
CREATE INDEX IF NOT EXISTS idx_audit_logs_chain
  ON public.audit_logs (document_id, created_at, id);

-- ═══════════════════════════════════════════════
-- Part 2: documents content hashes
-- ═══════════════════════════════════════════════

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash_at_send BYTEA,
  ADD COLUMN IF NOT EXISTS content_hash_at_completion BYTEA,
  ADD COLUMN IF NOT EXISTS completion_merkle_root BYTEA;
