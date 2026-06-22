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

-- ═══════════════════════════════════════════════
-- Part 3: certificates and evidence_log_entries tables
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE,
  content_hash_at_send BYTEA NOT NULL,
  content_hash_at_completion BYTEA NOT NULL,
  chain_root_hash BYTEA NOT NULL,
  tst_token BYTEA,
  merkle_root_at_completion BYTEA,
  pdf_storage_path TEXT,
  json_manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tsa_issued_at TIMESTAMPTZ
);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "certificates_owner_select" ON public.certificates FOR SELECT
  USING (
    document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid())
  );

CREATE POLICY "certificates_public_select" ON public.certificates FOR SELECT
  USING (true);

CREATE POLICY "certificates_service_all" ON public.certificates FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

GRANT SELECT ON public.certificates TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.certificates TO service_role;

CREATE TABLE IF NOT EXISTS public.evidence_log_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date DATE UNIQUE NOT NULL,
  merkle_root BYTEA NOT NULL,
  entry_count INT NOT NULL,
  prev_log_hash BYTEA,
  log_hash BYTEA NOT NULL,
  rekor_entry_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.evidence_log_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "evidence_log_entries_public_select" ON public.evidence_log_entries FOR SELECT USING (true);
CREATE POLICY "evidence_log_entries_service_all" ON public.evidence_log_entries FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

GRANT SELECT ON public.evidence_log_entries TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.evidence_log_entries TO service_role;

-- verify_document_audit_chain: walks the chain, returns first broken row
CREATE OR REPLACE FUNCTION public.verify_document_audit_chain(p_document_id UUID)
RETURNS TABLE(ok BOOLEAN, broken_at UUID, expected_hash BYTEA, actual_hash BYTEA)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_row RECORD;
  v_prev BYTEA;
  v_canonical TEXT;
  v_expected BYTEA;
BEGIN
  v_prev := NULL;
  FOR v_row IN
    SELECT * FROM public.audit_logs
    WHERE document_id = p_document_id
    ORDER BY created_at ASC, id ASC
  LOOP
    v_canonical := public.canonical_audit_json(v_row);
    IF v_prev IS NULL THEN
      v_expected := digest(v_canonical, 'sha256');
    ELSE
      v_expected := digest(v_prev || convert_to(v_canonical, 'UTF8'), 'sha256');
    END IF;

    IF v_row.hash IS DISTINCT FROM v_expected THEN
      ok := false;
      broken_at := v_row.id;
      expected_hash := v_expected;
      actual_hash := v_row.hash;
      RETURN NEXT;
      RETURN;
    END IF;

    v_prev := v_row.hash;
  END LOOP;

  ok := true;
  RETURN NEXT;
END;
$$;

-- merkle_root_for_document: simple pairwise SHA-256, odd-promote.
-- Matches JS merkleRoot() from src/lib/merkle.ts.
CREATE OR REPLACE FUNCTION public.merkle_root_for_document(p_document_id UUID)
RETURNS BYTEA
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_leaves BYTEA[];
  v_level BYTEA[];
  v_next BYTEA[];
  v_i INT;
BEGIN
  SELECT array_agg(hash ORDER BY created_at ASC, id ASC)
  INTO v_leaves
  FROM public.audit_logs
  WHERE document_id = p_document_id AND hash IS NOT NULL;

  IF v_leaves IS NULL OR array_length(v_leaves, 1) = 0 THEN
    RETURN NULL;
  END IF;

  v_level := v_leaves;
  WHILE array_length(v_level, 1) > 1 LOOP
    v_next := ARRAY[]::BYTEA[];
    v_i := 1;
    WHILE v_i <= array_length(v_level, 1) LOOP
      IF v_i = array_length(v_level, 1) THEN
        -- Odd level: promote unchanged
        v_next := array_append(v_next, v_level[v_i]);
      ELSE
        v_next := array_append(v_next, digest(v_level[v_i] || v_level[v_i + 1], 'sha256'));
      END IF;
      v_i := v_i + 2;
    END LOOP;
    v_level := v_next;
  END LOOP;

  RETURN v_level[1];
END;
$$;
