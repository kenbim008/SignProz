# Stage 2 — Signing Integrity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the signing ceremony server-enforced, transactional, and data-minimal. Prevent empty-signature submissions, bypass of sequential ordering, and leakage of other signers' data.

**Architecture:** The `/api/documents/[id]/sign` route is rewritten to: (1) load required fields and validate every submitted value server-side, (2) check sequential ordering before accepting, (3) run all mutations in a single database transaction, (4) return only current-signer data from public endpoints.

**Tech Stack:** Supabase admin client (for RPC-style transactions), TypeScript

---

### Task 2.1: Server-enforce required fields and field validation

**Files:**
- Modify: `src/app/api/documents/[id]/sign/route.ts`

- [ ] **Step 1: Add field validation before accepting signature**

Replace the current loop that updates fields with a validation pass first. Reject if:
- Any required field assigned to this signer is missing
- Any submitted field ID doesn't belong to this signer
- Signature values exceed 500KB (base64 image size limit)
- Typed signature values are empty strings

```typescript
// After loading signer and before updating fields:

// Load all required fields assigned to this signer
const { data: assignedFields, error: fieldsError } = await supabaseAdmin
  .from('signature_fields')
  .select('*')
  .eq('signer_id', signer.id)

if (fieldsError) {
  return Response.json({ error: 'Failed to load signature fields' }, { status: 500 })
}

// Collect submitted field IDs
const submittedFieldIds = new Set(fields.map((f: { fieldId: string }) => f.fieldId))

// Check every required field is submitted
const missingFields = assignedFields.filter(f => f.is_required && !submittedFieldIds.has(f.id))
if (missingFields.length > 0) {
  return Response.json({
    error: 'Missing required fields',
    missingFields: missingFields.map(f => f.id),
  }, { status: 400 })
}

// Check every submitted field belongs to this signer
const validFieldIds = new Set(assignedFields.map(f => f.id))
const invalidFields = fields.filter((f: { fieldId: string }) => !validFieldIds.has(f.fieldId))
if (invalidFields.length > 0) {
  return Response.json({
    error: 'Invalid fields submitted',
    invalidFields: invalidFields.map(f => f.fieldId),
  }, { status: 400 })
}

// Validate field values
for (const field of fields) {
  // Check size limit for image data (signature fields)
  if (typeof field.value === 'string' && field.value.startsWith('data:image/')) {
    const sizeInBytes = (field.value.length * 3) / 4
    if (sizeInBytes > 500 * 1024) {
      return Response.json({
        error: `Signature image exceeds 500KB limit (field: ${field.fieldId})`,
      }, { status: 400 })
    }
  }
  // Check typed signatures are non-empty
  if (typeof field.value === 'string' && field.value.trim() === '') {
    return Response.json({
      error: `Field ${field.fieldId} cannot be empty`,
    }, { status: 400 })
  }
}
```

Place this block between step 5 (document status check) and step 6 (field updates), replacing the original steps 6-7.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documents/\[id\]/sign/route.ts
git commit -m "fix: server-enforce required field validation and field ownership"
```

---

### Task 2.2: Server-enforce sequential signing order

**Files:**
- Modify: `src/app/api/documents/[id]/sign/route.ts`

- [ ] **Step 1: Add sequential order check**

After loading all signers, check if sequential mode is active and reject if the current signer isn't first in order:

```typescript
// Check sequential signing order
const { data: allSigners } = await supabaseAdmin
  .from('signers')
  .select('*')
  .eq('document_id', documentId)
  .order('order', { ascending: true })

if (!allSigners) {
  return Response.json({ error: 'Failed to load signers' }, { status: 500 })
}

const hasSequential = allSigners.some(s => s.order > 0)

if (hasSequential) {
  const unsignedInOrder = allSigners.filter(s => !s.signed_at)
  if (unsignedInOrder.length > 0 && unsignedInOrder[0].id !== signer.id) {
    return Response.json({
      error: 'Signing order enforced. Another signer must sign first.',
    }, { status: 403 })
  }
}
```

Insert this block after loading the document (step 5) and before field validation.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documents/\[id\]/sign/route.ts
git commit -m "fix: enforce sequential signing order server-side"
```

---

### Task 2.3: Return only current-signer data from public endpoints

**Files:**
- Modify: `src/app/api/sign/[documentId]/route.ts`

- [ ] **Step 1: Rewrite the public sign data endpoint**

Replace the current `select('*, signature_fields(*), signers(*)')` with a purpose-built DTO:

```typescript
// src/app/api/sign/[documentId]/route.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

interface RouteParams {
  params: Promise<{ documentId: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { documentId } = await params
    const url = new URL(request.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    // Look up the signer by token
    const { data: signer } = await supabaseAdmin
      .from('signers')
      .select('id, name, signed_at, document_id, token_expires_at')
      .eq('magic_token', token)
      .eq('document_id', documentId)
      .single()

    if (!signer) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    if (signer.signed_at) {
      return NextResponse.json({ state: 'already_signed' })
    }

    // Load document (minimal fields)
    const { data: document } = await supabaseAdmin
      .from('documents')
      .select('id, title, content, status')
      .eq('id', documentId)
      .single()

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (document.status === 'completed') {
      return NextResponse.json({ state: 'completed' })
    }

    // Load only this signer's fields
    const { data: fields } = await supabaseAdmin
      .from('signature_fields')
      .select('id, field_type, position_x, position_y, width, height, is_required')
      .eq('signer_id', signer.id)

    // Check if document has sequential ordering
    const { data: allSigners } = await supabaseAdmin
      .from('signers')
      .select('id, signed_at, "order"')
      .eq('document_id', documentId)
      .order('order', { ascending: true })

    const hasSequential = allSigners?.some(s => s.order > 0)
    let state = 'ready'

    if (hasSequential) {
      const unsignedInOrder = allSigners?.filter(s => !s.signed_at)
      if (unsignedInOrder && unsignedInOrder.length > 0 && unsignedInOrder[0].id !== signer.id) {
        state = 'sequential_wait'
      }
    }

    return NextResponse.json({
      state,
      document: {
        id: document.id,
        title: document.title,
        content: document.content,
        status: document.status,
      },
      signer: {
        id: signer.id,
        name: signer.name,
      },
      fields: fields || [],
    })
  } catch (error) {
    console.error('Sign data error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/sign/\[documentId\]/route.ts
git commit -m "fix: return only current-signer data from public sign endpoint"
```

---

### Task 2.4: Add signer token uniqueness constraint

**Files:**
- Create: `supabase/migrations/00004_signing_integrity.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Run in Supabase SQL Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00004_signing_integrity.sql
git commit -m "fix: add unique constraint on signer tokens and cross-document field check"
```

---

### Verification Checklist (Stage 2)

- [ ] All required fields validated server-side before signature accepted
- [ ] Submitted field IDs validated against signer's assigned fields
- [ ] Sequential signing enforced server-side (rejects out-of-order signers)
- [ ] Public `/api/sign/[id]` returns only current signer's data
- [ ] No `signers(*)` or raw `signature_fields(*)` exposed via public API
- [ ] Signature image size limited to 500KB
- [ ] Empty signature values rejected
- [ ] Signer magic tokens unique at database level
- [ ] Cross-document field assignment prevented by DB trigger
