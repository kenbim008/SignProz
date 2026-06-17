-- =============================================
-- PL/pgSQL tests for migration 00008 — hash chain
-- Uses DO $$ blocks for assertions. Fails fast.
-- =============================================

\set ON_ERROR_STOP on

-- Setup: create a test user and a test document
INSERT INTO public.profiles (id, email, full_name)
VALUES ('22222222-2222-2222-2222-222222222222', 'test@example.com', 'Test User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.documents (id, user_id, title, status, expiration_days)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Test Doc', 'draft', 7)
ON CONFLICT (id) DO NOTHING;

-- Clean up any leftover audit rows from previous test runs
DELETE FROM public.audit_logs WHERE document_id = '11111111-1111-1111-1111-111111111111';

-- ═══════════════════════════════════════════════
-- Test 1: first audit_logs insert sets hash, prev_hash is NULL
-- ═══════════════════════════════════════════════
INSERT INTO public.audit_logs (document_id, action, actor_email, metadata)
VALUES ('11111111-1111-1111-1111-111111111111', 'document_created', 'owner@x.com', '{"title":"Test Doc"}');

\echo Test 1: first row has hash, prev_hash is null
DO $$
DECLARE
  v_hash BYTEA;
  v_prev BYTEA;
BEGIN
  SELECT hash, prev_hash INTO v_hash, v_prev
  FROM public.audit_logs
  WHERE document_id = '11111111-1111-1111-1111-111111111111'
  ORDER BY created_at LIMIT 1;
  IF v_hash IS NULL THEN RAISE EXCEPTION 'FAIL 1a: hash should be set'; END IF;
  IF v_prev IS NOT NULL THEN RAISE EXCEPTION 'FAIL 1b: prev_hash should be NULL on first row'; END IF;
  IF length(v_hash) <> 32 THEN RAISE EXCEPTION 'FAIL 1c: hash should be 32 bytes (SHA-256), got %', length(v_hash); END IF;
  \echo '  hash length OK: 32 bytes';
END $$;

-- ═══════════════════════════════════════════════
-- Test 2: second insert chains off the first
-- ═══════════════════════════════════════════════
INSERT INTO public.audit_logs (document_id, action, actor_email, metadata)
VALUES ('11111111-1111-1111-1111-111111111111', 'document_sent', 'owner@x.com', '{}');

\echo Test 2: second row prev_hash equals first row hash
DO $$
DECLARE
  v_first_hash BYTEA;
  v_second_prev BYTEA;
BEGIN
  SELECT hash INTO v_first_hash FROM public.audit_logs
  WHERE document_id = '11111111-1111-1111-1111-111111111111'
  ORDER BY created_at LIMIT 1;

  SELECT prev_hash INTO v_second_prev FROM public.audit_logs
  WHERE document_id = '11111111-1111-1111-1111-111111111111'
  ORDER BY created_at DESC LIMIT 1;

  IF v_first_hash <> v_second_prev THEN RAISE EXCEPTION 'FAIL 2: second row prev_hash should equal first row hash'; END IF;
  \echo '  chain link OK';
END $$;

-- ═══════════════════════════════════════════════
-- Test 3: verify_document_audit_chain returns ok=true for unbroken chain
-- ═══════════════════════════════════════════════
\echo Test 3: chain verification passes for unbroken chain
DO $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  SELECT ok INTO v_ok FROM public.verify_document_audit_chain('11111111-1111-1111-1111-111111111111');
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 3: chain should verify as ok'; END IF;
  \echo '  chain verification OK';
END $$;

-- ═══════════════════════════════════════════════
-- Test 4: tampering with a row is detected
-- ═══════════════════════════════════════════════
\echo Test 4: tampering with metadata breaks the chain
DO $$
DECLARE
  v_victim_id UUID;
  v_ok BOOLEAN;
BEGIN
  -- Get the first row's ID
  SELECT id INTO v_victim_id FROM public.audit_logs
  WHERE document_id = '11111111-1111-1111-1111-111111111111'
  ORDER BY created_at LIMIT 1;

  -- Tamper: change the metadata (affects the canonical JSON)
  UPDATE public.audit_logs SET metadata = '{"title":"TAMPERED"}' WHERE id = v_victim_id;

  -- Verify the chain is now broken
  SELECT ok INTO v_ok FROM public.verify_document_audit_chain('11111111-1111-1111-1111-111111111111');
  IF v_ok THEN RAISE EXCEPTION 'FAIL 4: tampered chain should not verify'; END IF;
  \echo '  tamper detection OK';

  -- Restore for subsequent tests
  UPDATE public.audit_logs SET metadata = '{"title":"Test Doc"}' WHERE id = v_victim_id;
END $$;

-- ═══════════════════════════════════════════════
-- Test 5: merkle_root_for_document returns a 32-byte hash for non-empty chain
-- ═══════════════════════════════════════════════
\echo Test 5: merkle root is a 32-byte hash
DO $$
DECLARE
  v_root BYTEA;
  v_len INT;
BEGIN
  SELECT public.merkle_root_for_document('11111111-1111-1111-1111-111111111111') INTO v_root;
  IF v_root IS NULL THEN RAISE EXCEPTION 'FAIL 5a: merkle root should not be null'; END IF;
  v_len := length(v_root);
  IF v_len <> 32 THEN RAISE EXCEPTION 'FAIL 5b: merkle root should be 32 bytes, got %', v_len; END IF;
  \echo '  merkle root length OK: 32 bytes';
END $$;

-- ═══════════════════════════════════════════════
-- Test 6: merkle root differs when chain is different
-- ═══════════════════════════════════════════════
\echo Test 6: merkle root for different document gives different result
DO $$
DECLARE
  v_root1 BYTEA;
  v_root2 BYTEA;
BEGIN
  SELECT public.merkle_root_for_document('11111111-1111-1111-1111-111111111111') INTO v_root1;

  -- Insert a row for a second document with different data
  INSERT INTO public.documents (id, user_id, title, status, expiration_days)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Other Doc', 'draft', 7)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.audit_logs (document_id, action, actor_email, metadata)
  VALUES ('33333333-3333-3333-3333-333333333333', 'document_created', 'other@x.com', '{"title":"Other"}');

  SELECT public.merkle_root_for_document('33333333-3333-3333-3333-333333333333') INTO v_root2;

  IF v_root1 IS NOT DISTINCT FROM v_root2 THEN RAISE EXCEPTION 'FAIL 6: merkle roots should differ for different chains'; END IF;
  \echo '  merkle root uniqueness OK';

  -- Cleanup second document
  DELETE FROM public.audit_logs WHERE document_id = '33333333-3333-3333-3333-333333333333';
  DELETE FROM public.documents WHERE id = '33333333-3333-3333-3333-333333333333';
END $$;

-- ═══════════════════════════════════════════════
-- Cleanup
-- ═══════════════════════════════════════════════
DELETE FROM public.audit_logs WHERE document_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.documents WHERE id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222';

\echo '========================================'
\echo 'All 00008 PL/pgSQL tests passed.'
\echo '========================================'
