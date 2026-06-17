-- =============================================
-- D.2 — Domain service workflow functions
-- Adds: sign_document() (atomic signing) and with_transaction() (generic helper)
-- Idempotent: safe to re-run
-- =============================================

-- Drop existing functions (in case of signature changes)
DROP FUNCTION IF EXISTS public.sign_document(UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.with_transaction(TEXT);

-- Function 1: sign_document
-- Atomically signs a document as a specific signer. Validates token, expiry,
-- sequential order, and updates fields + signer + document status in one transaction.
CREATE OR REPLACE FUNCTION public.sign_document(
  p_document_id UUID,
  p_magic_token TEXT,
  p_field_values JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_signer signers%ROWTYPE;
  v_document documents%ROWTYPE;
  v_field JSONB;
  v_field_id UUID;
  v_field_value JSONB;
  v_all_signed BOOLEAN;
  v_remaining INTEGER;
  v_status TEXT;
BEGIN
  -- 1. Look up the signer (must match both document and token)
  SELECT * INTO v_signer FROM signers
  WHERE magic_token = p_magic_token AND document_id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TOKEN' USING ERRCODE = '28000';
  END IF;

  -- 2. Reject if already signed
  IF v_signer.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SIGNED' USING ERRCODE = '23P01';
  END IF;

  -- 3. Reject if token expired
  IF v_signer.token_expires_at < NOW() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRED' USING ERRCODE = '28000';
  END IF;

  -- 4. Lock the document row
  SELECT * INTO v_document FROM documents WHERE id = p_document_id FOR UPDATE;

  IF v_document.status NOT IN ('sent', 'partially_signed') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '23P01';
  END IF;

  -- 5. Sequential signing: if signer.order > 0, prior signers must have signed
  IF v_signer.order > 0 THEN
    IF EXISTS (
      SELECT 1 FROM signers
      WHERE document_id = p_document_id
        AND "order" < v_signer.order
        AND signed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'SEQUENTIAL_ORDER' USING ERRCODE = '23P01';
    END IF;
  END IF;

  -- 6. Apply each field value
  FOR v_field IN SELECT * FROM jsonb_array_elements(p_field_values)
  LOOP
    v_field_id := (v_field->>'fieldId')::UUID;
    v_field_value := v_field->'value';

    -- Verify the field belongs to this signer
    IF NOT EXISTS (
      SELECT 1 FROM signature_fields
      WHERE id = v_field_id AND signer_id = v_signer.id
    ) THEN
      RAISE EXCEPTION 'INVALID_FIELD' USING ERRCODE = '23514';
    END IF;

    UPDATE signature_fields SET filled_value = v_field_value, updated_at = NOW()
    WHERE id = v_field_id;
  END LOOP;

  -- 7. Mark signer as signed
  UPDATE signers SET signed_at = NOW() WHERE id = v_signer.id;

  -- 8. Audit log
  INSERT INTO audit_logs (document_id, actor_email, action, metadata)
  VALUES (p_document_id, v_signer.email, 'signer_signed', jsonb_build_object(
    'signerId', v_signer.id,
    'fieldsCount', jsonb_array_length(p_field_values)
  ));

  -- 9. Check if document is now complete
  SELECT COUNT(*) INTO v_remaining
  FROM signers
  WHERE document_id = p_document_id AND signed_at IS NULL;

  v_all_signed := v_remaining = 0;

  IF v_all_signed THEN
    UPDATE documents SET status = 'completed', completed_at = NOW() WHERE id = p_document_id;
    v_status := 'completed';
  ELSE
    UPDATE documents SET status = 'partially_signed' WHERE id = p_document_id;
    v_status := 'partially_signed';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'documentStatus', v_status,
    'signerId', v_signer.id
  );
END;
$$;

-- Function 2: with_transaction
-- Generic helper: executes a SQL string in a transaction. Returns success/error.
-- Used by JS services for atomic multi-statement workflows.
CREATE OR REPLACE FUNCTION public.with_transaction(p_sql TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  EXECUTE p_sql;
  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'code', SQLSTATE
    );
END;
$$;

-- Grant execute to authenticated and anon (signers aren't auth'd)
GRANT EXECUTE ON FUNCTION public.sign_document(UUID, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.with_transaction(TEXT) TO service_role;
