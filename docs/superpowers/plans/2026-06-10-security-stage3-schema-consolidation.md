# Stage 3 — Schema Consolidation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix database drift by resolving the `profiles.email` discrepancy, expanding field types to match the dashboard UI, standardizing coordinate units, and creating a canonical migration that can be applied from scratch.

**Architecture:** A single new migration (`00005_schema_consolidation.sql`) that adds missing columns, expands constraints, and creates a canonical state. App code is updated to match.

**Tech Stack:** PostgreSQL, Supabase, TypeScript

---

### Task 3.1: Create canonical schema migration

**Files:**
- Create: `supabase/migrations/00005_schema_consolidation.sql`

- [ ] **Step 1: Write the migration**

```sql
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

-- Ensure signer magic_token is unique
ALTER TABLE public.signers ADD CONSTRAINT IF NOT EXISTS signers_magic_token_key UNIQUE (magic_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signers_magic_token_unique ON public.signers(magic_token);

-- Ensure auth_tokens token is unique (was already UNIQUE but add index if missing)
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_token_unique ON public.auth_tokens(token);

-- Add NOT NULL to signers.email if not already set
ALTER TABLE public.signers ALTER COLUMN email SET NOT NULL;
```

- [ ] **Step 2: Apply the migration**

Run in Supabase SQL Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00005_schema_consolidation.sql
git commit -m "fix: consolidate schema — add profiles.email, expand field types, standardize coordinates"
```

---

### Task 3.2: Populate profiles.email when users sign up or login

**Files:**
- Modify: `src/lib/supabase/admin.ts` (add email sync trigger)

- [ ] **Step 1: Create a trigger to sync auth email to profiles**

Run this in Supabase SQL Editor:

```sql
-- Sync email from auth.users to profiles on user creation
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email
  WHERE id = NEW.id AND (profiles.email IS NULL OR profiles.email != NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_email_sync
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();
```

- [ ] **Step 2: Add email sync to existing handle_new_user trigger**

Update the existing `handle_new_user()` function to also set email:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, plan_tier, referral_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'free',
    'SF-' || upper(substring(gen_random_uuid()::text, 1, 8))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Run these in Supabase SQL Editor.

- [ ] **Step 3: Backfill existing profiles with auth user emails**

```sql
UPDATE public.profiles p
SET email = au.email
FROM auth.users au
WHERE p.id = au.id AND p.email IS NULL;
```

- [ ] **Step 4: Commit migration additions**

```bash
git add supabase/migrations/00005_schema_consolidation.sql
git commit -m "fix: sync auth user email to profiles table"
```

---

### Task 3.3: Fix document sign route to use profiles.email or auth email

**Files:**
- Modify: `src/app/api/documents/[id]/sign/route.ts`

- [ ] **Step 1: Update email lookups**

Where the code currently selects `email` from `profiles`, it should now work since `profiles.email` exists. Verify:

```typescript
// These queries now work because profiles.email is populated:
const { data: owner } = await supabaseAdmin
  .from('profiles')
  .select('email, full_name')
  .eq('id', document.user_id)
  .single()
```

If `profiles.email` is still null for some users, add a fallback:

```typescript
// Fallback to auth user email if profiles.email is null
if (!owner?.email) {
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(document.user_id)
  ownerEmail = authUser?.user?.email || ''
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documents/\[id\]/sign/route.ts
git commit -m "fix: add email fallback for owner notification emails"
```

---

### Task 3.4: Fix field coordinate system in editor

**Files:**
- Modify: `src/app/dashboard/documents/[id]/page.tsx`

- [ ] **Step 1: Normalize field creation to use percentage coordinates**

The dashboard places fields at pixel positions on a 612x792 canvas. Convert to percentages before saving:

```typescript
// In the handlePlaceField or field creation function:
const createField = async (fieldData: { type: string; x: number; y: number; width: number; height: number }) => {
  const canvasWidth = 612
  const canvasHeight = 792

  const payload = {
    document_id: documentId,
    signer_id: selectedSignerId,
    field_type: fieldData.type,
    position_x: Math.round((fieldData.x / canvasWidth) * 100 * 100) / 100, // percentage, 2 decimals
    position_y: Math.round((fieldData.y / canvasHeight) * 100 * 100) / 100,
    width: Math.round((fieldData.width / canvasWidth) * 100 * 100) / 100,
    height: Math.round((fieldData.height / canvasHeight) * 100 * 100) / 100,
    page_number: currentPage,
  }

  // POST to /api/documents/[id]/fields
}
```

When rendering fields for the signer, convert back to pixels:
```typescript
const pixelX = (field.position_x / 100) * canvasWidth
const pixelY = (field.position_y / 100) * canvasHeight
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/documents/\[id\]/page.tsx
git commit -m "fix: normalize field coordinates to percentage-based system"
```

---

### Verification Checklist (Stage 3)

- [ ] `profiles.email` column exists and is auto-populated via trigger
- [ ] All 14 field types accepted by database constraint (signature through address)
- [ ] Field coordinates stored as percentages (0-100) with DB range constraints
- [ ] Signer magic tokens have unique constraint
- [ ] Auth token unique index exists
- [ ] Field creation in dashboard converts pixels to percentages
- [ ] Field rendering for signers converts percentages to pixels
- [ ] Existing profiles backfilled with auth user emails
