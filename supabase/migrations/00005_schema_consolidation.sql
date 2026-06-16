-- =============================================
-- Schema consolidation
-- Fixes drift between code and database
-- =============================================

-- Add email column to profiles (was referenced by code but missing)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Expand field types to match dashboard UI palette
ALTER TABLE public.signature_fields DROP CONSTRAINT IF EXISTS signature_fields_field_type_check;
ALTER TABLE public.signature_fields ADD CONSTRAINT signature_fields_field_type_check
  CHECK (field_type IN (
    'signature', 'initials', 'date', 'text',
    'checkbox', 'radio', 'dropdown', 'attachment',
    'name', 'email', 'company', 'title', 'phone', 'address'
  ));

-- Add page_number to signature_fields for multi-page documents
ALTER TABLE public.signature_fields ADD COLUMN IF NOT EXISTS page_number INT NOT NULL DEFAULT 1;

-- Add label column to signature_fields
ALTER TABLE public.signature_fields ADD COLUMN IF NOT EXISTS label TEXT;

-- Standardize coordinate system: store as percentages (0-100)
ALTER TABLE public.signature_fields ADD CONSTRAINT signature_fields_position_x_check
  CHECK (position_x >= 0 AND position_x <= 100);
ALTER TABLE public.signature_fields ADD CONSTRAINT signature_fields_position_y_check
  CHECK (position_y >= 0 AND position_y <= 100);
ALTER TABLE public.signature_fields ADD CONSTRAINT signature_fields_width_check
  CHECK (width >= 1 AND width <= 100);
ALTER TABLE public.signature_fields ADD CONSTRAINT signature_fields_height_check
  CHECK (height >= 1 AND height <= 100);

-- Note: signers magic_token unique constraint was added in 00004_signing_integrity.sql

-- Ensure auth_tokens token is unique (was already UNIQUE but add index if missing)
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_token_unique ON public.auth_tokens(token);

-- Add NOT NULL to signers.email if not already set
ALTER TABLE public.signers ALTER COLUMN email SET NOT NULL;
