-- =============================================
-- Ensure the enforce_signer_document_match trigger exists
-- Idempotent: safe to re-run
-- =============================================

-- Function: create or replace
CREATE OR REPLACE FUNCTION public.check_signer_document_match()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.signer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.signers
      WHERE id = NEW.signer_id AND document_id = NEW.document_id
    ) THEN
      RAISE EXCEPTION 'signer_id must belong to the same document_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: drop if exists, then create
DROP TRIGGER IF EXISTS enforce_signer_document_match ON public.signature_fields;
CREATE TRIGGER enforce_signer_document_match
  BEFORE INSERT OR UPDATE ON public.signature_fields
  FOR EACH ROW EXECUTE FUNCTION public.check_signer_document_match();
