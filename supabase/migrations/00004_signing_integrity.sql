-- =============================================
-- Signing integrity constraints
-- =============================================

-- Ensure magic tokens are unique
ALTER TABLE public.signers ADD CONSTRAINT signers_magic_token_unique UNIQUE (magic_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signers_magic_token_unique ON public.signers(magic_token);

-- Ensure signer_id belongs to the same document as the field (cross-document check)
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

CREATE TRIGGER enforce_signer_document_match
  BEFORE INSERT OR UPDATE ON public.signature_fields
  FOR EACH ROW EXECUTE FUNCTION public.check_signer_document_match();
