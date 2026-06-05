-- =============================================
-- SignProz Registration Wizard Schema
-- Stores multi-step registration progress
-- =============================================

-- Table: registration_sessions
-- Tracks user progress through the signup wizard.
-- A row is created when the user submits email + terms.
CREATE TABLE IF NOT EXISTS public.registration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  phone TEXT,
  has_verified_email BOOLEAN NOT NULL DEFAULT false,
  has_verified_phone BOOLEAN NOT NULL DEFAULT false,
  referral_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.registration_sessions TO authenticated;
GRANT INSERT ON TABLE public.registration_sessions TO anon;

CREATE INDEX IF NOT EXISTS idx_registration_sessions_email ON public.registration_sessions(email);

ALTER TABLE public.registration_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registration_sessions_owner_all" ON public.registration_sessions FOR ALL
  TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE TRIGGER registration_sessions_updated_at
  BEFORE UPDATE ON public.registration_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Add phone column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
GRANT UPDATE (phone) ON TABLE public.profiles TO authenticated;
