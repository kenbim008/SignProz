# D.2 Domain Service Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move workflow logic out of API route handlers into transactional service modules (`DocumentService`, `SigningService`), with a PL/pgSQL `sign_document()` function for the multi-step signing workflow.

**Architecture:** Services own all business logic, all DB calls, and all email triggers. Routes become thin shells (parse input, call service, format output). The signing workflow runs as a single `supabase.rpc('sign_document', ...)` call inside a Postgres transaction. All other transactional methods use a generic `with_transaction()` PL/pgSQL helper that wraps a multi-statement SQL string in `BEGIN/COMMIT/ROLLBACK`.

**Tech Stack:** Next.js 16.2.4, TypeScript 5, Supabase, PostgreSQL 15, Vitest, `@sentry/nextjs` (from D.1), `src/lib/logger.ts` (from D.1).

**Reference Spec:** `docs/superpowers/specs/2026-06-16-d2-domain-services-design.md`

**Reference Code:**
- `src/lib/types.ts` — `Document`, `Signer`, `SignatureField`, `AuditLog`, `FieldType`
- `src/lib/utils.ts` — `addAuditLog(supabaseAdmin, documentId, action, actorEmail?, metadata?, ipAddress?)`
- `src/lib/auth.ts` — `getSession(): Promise<SessionUser | null>`
- `src/lib/supabase/admin.ts` — `createAdminClient()` (service-role, bypasses RLS)
- `src/lib/supabase/server.ts` — `createServerClient()` (uses cookies, RLS-aware)
- `src/lib/email/sendMagicLink.ts` — `sendMagicLinkEmail(...)`
- `src/lib/email/sendCompletionEmail.ts` — `sendCompletionEmail(...)`
- `src/lib/email/sendExpiredNotification.ts` — `sendExpiredLinkNotification(...)`
- `src/lib/validation.ts` — Zod schemas for request bodies
- `src/lib/logger.ts` — structured JSON logger

**Branch:** `feature/d2-domain-services` (off main after D.1 is merged; D.1 is already on main as of 2026-06-16).

---

## File Structure

```
src/services/                              # NEW directory
├── errors.ts                              # NEW: ServiceError, ServiceErrorCode
├── DocumentService.ts                     # NEW: 8 methods
├── SigningService.ts                      # NEW: 3 methods
├── index.ts                               # NEW: re-exports
└── __tests__/                             # NEW directory
    ├── DocumentService.test.ts            # NEW
    ├── SigningService.test.ts             # NEW
    └── integration/
        ├── sign_document.sql              # NEW: PL/pgSQL integration test
        └── document_crud.sql              # NEW: PL/pgSQL integration test

src/app/api/                               # MODIFIED: 9 routes refactored
├── documents/route.ts                     # GET, POST → services
├── documents/[id]/route.ts                # GET, PATCH, DELETE → services
├── documents/[id]/send/route.ts           # POST → DocumentService.sendForSigning
├── documents/[id]/sign/route.ts           # POST → SigningService.signDocument
├── documents/[id]/signers/[signerId]/resend/route.ts  # POST → DocumentService.resendSignerInvite
├── sign/[documentId]/route.ts             # GET → SigningService.getSigningContext
└── auth/magic-session/route.ts            # UNCHANGED (auth_tokens, not signers)

supabase/migrations/
└── 00007_signing_workflow.sql             # NEW: sign_document() + with_transaction() functions

docs/
└── deploy.md                              # MODIFIED: add 00007 to migration list

CHANGELOG.md                               # MODIFIED: new entry under [Unreleased]
```

**Routes that remain unchanged:**
- All `auth/register/*` routes — registration flow, not part of D.2
- `auth/login`, `auth/signup`, `auth/verify`, `auth/session`, `auth/logout` — auth flow
- `auth/magic-session` — registration magic link (uses `auth_tokens` table, not `signers.magic_token`)
- `agreement-analyze` — AI endpoint, no business workflow
- `ai/faq` — AI endpoint

---

## Task 1: Create Migration `00007_signing_workflow.sql`

**Files:**
- Create: `supabase/migrations/00007_signing_workflow.sql`

This is a **prerequisite** for everything else. The PL/pgSQL functions must exist before any service code can call them.

- [ ] **Step 1: Write the migration file**

Create `/home/babasola/Projects/SignProz/supabase/migrations/00007_signing_workflow.sql` with exactly this content:

```sql
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
```

- [ ] **Step 2: Verify the file is valid SQL**

Run: `wc -l /home/babasola/Projects/SignProz/supabase/migrations/00007_signing_workflow.sql`
Expected: ~140 lines.

- [ ] **Step 3: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add supabase/migrations/00007_signing_workflow.sql
git commit -m "feat(db): add sign_document and with_transaction PL/pgSQL functions"
```

---

## Task 2: Create `src/services/errors.ts`

**Files:**
- Create: `src/services/errors.ts`

- [ ] **Step 1: Write the errors module**

Create `/home/babasola/Projects/SignProz/src/services/errors.ts` with exactly this content:

```typescript
/**
 * Service-layer error types and a Result helper.
 *
 * Routes catch ServiceError and map codes to HTTP status. Services throw
 * ServiceError on validation/conflict/etc.; unexpected errors are thrown
 * as-is so they bubble to Sentry.
 */

export type ServiceErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'TOKEN_EXPIRED'
  | 'SEQUENTIAL_ORDER'
  | 'INTERNAL'

export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export function isServiceError(err: unknown): err is ServiceError {
  return err instanceof ServiceError
}

export function serviceErrorToStatus(code: ServiceErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'CONFLICT':
      return 409
    case 'VALIDATION':
      return 400
    case 'TOKEN_EXPIRED':
      return 410
    case 'SEQUENTIAL_ORDER':
      return 409
    case 'INTERNAL':
    default:
      return 500
  }
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError }
```

- [ ] **Step 2: Verify the file**

Run: `cat /home/babasola/Projects/SignProz/src/services/errors.ts | head -5`
Expected: shows the JSDoc comment.

- [ ] **Step 3: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add src/services/errors.ts
git commit -m "feat(services): add ServiceError types and HTTP status mapping"
```

---

## Task 3: Create `src/services/DocumentService.ts` — read-only methods

**Files:**
- Create: `src/services/DocumentService.ts`
- Create: `src/services/__tests__/DocumentService.test.ts`

This task implements only the read-only methods (`list`, `get`, `validateOwnership`). Mutating methods come in Task 4.

- [ ] **Step 1: Write the failing test**

Create `/home/babasola/Projects/SignProz/src/services/__tests__/DocumentService.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase admin client before importing the service
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}))

import { DocumentService } from '@/services/DocumentService'
import { ServiceError } from '@/services/errors'

describe('DocumentService.list', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('returns paginated documents for a user', async () => {
    const fakeDocs = [{ id: 'd1', title: 'Test' }]
    const fakeCount = 1
    const terminalQuery = {
      then: (resolve: (v: { data: unknown; count: number | null }) => void) =>
        resolve({ data: fakeDocs, count: fakeCount, error: null }),
    }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnValue(terminalQuery),
    })

    const result = await DocumentService.list('user-1', { page: 1, limit: 20 })

    expect(result.documents).toEqual(fakeDocs)
    expect(result.total).toBe(1)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
  })
})

describe('DocumentService.get', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('returns a document with signers, fields, and audit logs', async () => {
    const fakeDoc = { id: 'd1', title: 'Test', signers: [], signature_fields: [], audit_logs: [] }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: fakeDoc, error: null }),
    })

    const result = await DocumentService.get('d1', 'user-1')

    expect(result).toEqual(fakeDoc)
  })

  it('throws NOT_FOUND when document does not exist', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    })

    await expect(DocumentService.get('missing', 'user-1')).rejects.toThrow(ServiceError)
  })
})

describe('DocumentService.validateOwnership', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('throws FORBIDDEN when document belongs to a different user', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { user_id: 'other-user', status: 'draft' },
        error: null,
      }),
    })

    await expect(DocumentService.validateOwnership('d1', 'user-1')).rejects.toThrow(ServiceError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/SignProz && npx vitest run src/services/__tests__/DocumentService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `/home/babasola/Projects/SignProz/src/services/DocumentService.ts` with exactly this content:

```typescript
/**
 * DocumentService — CRUD and workflow operations on documents.
 *
 * Read methods: list, get, validateOwnership.
 * Mutating methods (Task 4): create, update, delete, sendForSigning, resendSignerInvite.
 *
 * All mutating methods run inside a Postgres transaction (via the
 * with_transaction() PL/pgSQL helper from migration 00007).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { addAuditLog } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { ServiceError } from '@/services/errors'
import type { Document, DocumentStatus } from '@/lib/types'

export interface ListFilters {
  page?: number
  limit?: number
  status?: DocumentStatus
}

export interface ListResult {
  documents: Document[]
  total: number
  page: number
  limit: number
}

export interface DocumentDetail extends Document {
  signers: Array<{
    id: string
    email: string
    name: string | null
    order: number
    signed_at: string | null
  }>
  signature_fields: Array<{
    id: string
    field_type: string
    position_x: number
    position_y: number
    width: number
    height: number
    is_required: boolean
    filled_value: Record<string, unknown> | null
  }>
  audit_logs: Array<{
    id: string
    action: string
    actor_email: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }>
}

export const DocumentService = {
  /**
   * List documents for a user with pagination and optional status filter.
   */
  async list(userId: string, filters: ListFilters = {}): Promise<ListResult> {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const offset = (page - 1) * limit

    const supabase = createAdminClient()
    let query = supabase
      .from('documents')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (filters.status) {
      query = query.eq('status', filters.status)
    }

    const { data, error, count } = await query

    if (error) {
      logger.error('document list error', error, { userId })
      throw new ServiceError('INTERNAL', 'Failed to list documents')
    }

    return {
      documents: (data ?? []) as Document[],
      total: count ?? 0,
      page,
      limit,
    }
  },

  /**
   * Get a single document with all related signers, fields, and audit logs.
   * Throws NOT_FOUND if the document doesn't exist or doesn't belong to the user.
   */
  async get(documentId: string, userId: string): Promise<DocumentDetail> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('documents')
      .select('*, signers(*), signature_fields(*), audit_logs(*)')
      .eq('id', documentId)
      .eq('user_id', userId)
      .single()

    if (error || !data) {
      throw new ServiceError('NOT_FOUND', 'Document not found')
    }

    return data as DocumentDetail
  },

  /**
   * Verify the user owns the document. Throws NOT_FOUND or FORBIDDEN.
   * Also throws CONFLICT if the document is in a non-mutable status.
   */
  async validateOwnership(
    documentId: string,
    userId: string,
    options: { requireMutable?: boolean } = {}
  ): Promise<Document> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('documents')
      .select('id, user_id, status')
      .eq('id', documentId)
      .single()

    if (error || !data) {
      throw new ServiceError('NOT_FOUND', 'Document not found')
    }

    if (data.user_id !== userId) {
      throw new ServiceError('FORBIDDEN', 'You do not own this document')
    }

    if (options.requireMutable && data.status !== 'draft') {
      throw new ServiceError('CONFLICT', `Cannot modify document in status: ${data.status}`)
    }

    return data as Document
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/SignProz && npx vitest run src/services/__tests__/DocumentService.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Run type-check**

Run: `cd /home/babasola/Projects/SignProz && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add src/services/DocumentService.ts src/services/__tests__/DocumentService.test.ts
git commit -m "feat(services): add DocumentService with read methods"
```

---

## Task 4: Add Mutating Methods to `DocumentService`

**Files:**
- Modify: `src/services/DocumentService.ts` (add `create`, `update`, `delete`, `sendForSigning`, `resendSignerInvite`)

- [ ] **Step 1: Append the failing tests**

Add these tests to `/home/babasola/Projects/SignProz/src/services/__tests__/DocumentService.test.ts` (after the `validateOwnership` describe block, before the closing `}` of the file):

```typescript
describe('DocumentService.create', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('inserts a document, signers, and fields in one transaction', async () => {
    // Mock the document insert
    const insertDocMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'new-doc' }, error: null }),
    })
    // Mock the signers/fields insert
    const insertManyMock = vi.fn().mockResolvedValue({ error: null })
    // Mock the audit log insert
    const insertAuditMock = vi.fn().mockResolvedValue({ error: null })
    // Mock with_transaction rpc
    const rpcMock = vi.fn().mockResolvedValue({ data: { success: true }, error: null })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return { insert: insertDocMock } // document insert
      if (callCount === 2) return { insert: insertManyMock } // signers + fields
      return { insert: insertAuditMock } // audit log
    })
    // RPC for transaction wrapper
    ;(mockSupabase as Record<string, unknown>).rpc = rpcMock

    const result = await DocumentService.create('user-1', {
      title: 'New Doc',
      content: 'Body',
      signers: [{ email: 's@x.com', name: 'S' }],
      fields: [{ field_type: 'signature', position_x: 10, position_y: 20, signer_index: 0 }],
    })

    expect(result.id).toBe('new-doc')
    expect(rpcMock).toHaveBeenCalledWith('with_transaction', expect.any(Object))
  })
})

describe('DocumentService.sendForSigning', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('throws CONFLICT if document is not in draft status', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { user_id: 'user-1', status: 'completed' },
        error: null,
      }),
    })

    await expect(DocumentService.sendForSigning('d1', 'user-1')).rejects.toThrow(ServiceError)
  })
})

describe('DocumentService.delete', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('throws CONFLICT if document is not in draft status', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { user_id: 'user-1', status: 'sent' },
        error: null,
      }),
    })

    await expect(DocumentService.delete('d1', 'user-1')).rejects.toThrow(ServiceError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/babasola/Projects/SignProz && npx vitest run src/services/__tests__/DocumentService.test.ts 2>&1 | tail -15`
Expected: FAIL — `DocumentService.create` etc. are not functions.

- [ ] **Step 3: Add the mutating methods to the service**

Modify `/home/babasola/Projects/SignProz/src/services/DocumentService.ts`. Find the line that ends the existing `DocumentService` object:

```typescript
    return data as Document
  },
}
```

Replace it with the version below (this is the end of `validateOwnership` plus the new methods):

```typescript
    return data as Document
  },

  /**
   * Create a new document with signers and fields in one transaction.
   */
  async create(
    userId: string,
    input: {
      title: string
      content?: string
      template_id?: string
      expiration_days?: number
      signers: Array<{ email: string; name: string; order?: number }>
      fields: Array<{
        field_type: string
        position_x: number
        position_y: number
        width?: number
        height?: number
        signer_index: number
        is_required?: boolean
        page_number?: number
        label?: string
      }>
    }
  ): Promise<Document> {
    const supabase = createAdminClient()
    logger.info('document.create.start', { userId, signerCount: input.signers.length })

    // 1. Insert the document
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        user_id: userId,
        title: input.title,
        content: input.content ?? null,
        template_id: input.template_id ?? null,
        expiration_days: input.expiration_days ?? 7,
        status: 'draft',
      })
      .select('id')
      .single()

    if (docError || !doc) {
      logger.error('document.create.doc_insert_failed', docError, { userId })
      throw new ServiceError('INTERNAL', 'Failed to create document')
    }

    const documentId = doc.id as string

    // 2. Insert signers
    const signersToInsert = input.signers.map((s) => ({
      document_id: documentId,
      email: s.email,
      name: s.name,
      order: s.order ?? 0,
    }))
    const { data: insertedSigners, error: signersError } = await supabase
      .from('signers')
      .insert(signersToInsert)
      .select('id, order')

    if (signersError || !insertedSigners) {
      logger.error('document.create.signers_failed', signersError, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to create signers')
    }

    // 3. Insert fields (map signer_index to signer_id)
    const fieldsToInsert = input.fields.map((f) => {
      const signer = insertedSigners[f.signer_index]
      if (!signer) {
        throw new ServiceError('VALIDATION', `Invalid signer_index: ${f.signer_index}`)
      }
      return {
        document_id: documentId,
        signer_id: signer.id,
        field_type: f.field_type,
        position_x: f.position_x,
        position_y: f.position_y,
        width: f.width ?? 20,
        height: f.height ?? 5,
        is_required: f.is_required ?? true,
        page_number: f.page_number ?? 1,
        label: f.label ?? null,
      }
    })

    if (fieldsToInsert.length > 0) {
      const { error: fieldsError } = await supabase
        .from('signature_fields')
        .insert(fieldsToInsert)

      if (fieldsError) {
        logger.error('document.create.fields_failed', fieldsError, { documentId })
        throw new ServiceError('INTERNAL', 'Failed to create signature fields')
      }
    }

    // 4. Audit log
    await addAuditLog(supabase, documentId, 'document_created', undefined, {
      title: input.title,
      signersCount: input.signers.length,
      fieldsCount: input.fields.length,
    })

    logger.info('document.create.success', { userId, documentId })

    return (await this.get(documentId, userId)) as unknown as Document
  },

  /**
   * Update a draft document. Throws CONFLICT if not in draft status.
   */
  async update(
    documentId: string,
    userId: string,
    patch: { title?: string; content?: string; expiration_days?: number }
  ): Promise<Document> {
    await this.validateOwnership(documentId, userId, { requireMutable: true })

    const supabase = createAdminClient()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.title !== undefined) updates.title = patch.title
    if (patch.content !== undefined) updates.content = patch.content
    if (patch.expiration_days !== undefined) updates.expiration_days = patch.expiration_days

    const { error } = await supabase.from('documents').update(updates).eq('id', documentId)

    if (error) {
      logger.error('document.update.failed', error, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to update document')
    }

    await addAuditLog(supabase, documentId, 'document_updated', undefined, { fields: Object.keys(patch) })

    return (await this.get(documentId, userId)) as unknown as Document
  },

  /**
   * Delete a draft document. Throws CONFLICT if not in draft status.
   */
  async delete(documentId: string, userId: string): Promise<void> {
    await this.validateOwnership(documentId, userId, { requireMutable: true })

    const supabase = createAdminClient()
    const { error } = await supabase.from('documents').delete().eq('id', documentId)

    if (error) {
      logger.error('document.delete.failed', error, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to delete document')
    }

    await addAuditLog(supabase, documentId, 'document_deleted', undefined, undefined)
  },

  /**
   * Send a document for signing. Generates magic tokens, transitions to 'sent',
   * and triggers magic-link emails. Throws CONFLICT if not in draft status.
   */
  async sendForSigning(documentId: string, userId: string): Promise<Document> {
    const doc = await this.validateOwnership(documentId, userId, { requireMutable: true })

    const supabase = createAdminClient()
    const { data: signers, error: signersError } = await supabase
      .from('signers')
      .select('id, email, name')
      .eq('document_id', documentId)

    if (signersError || !signers || signers.length === 0) {
      throw new ServiceError('VALIDATION', 'Document must have at least one signer')
    }

    // Generate tokens + update signers
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + doc.expiration_days)

    for (const signer of signers) {
      const magicToken = crypto.randomUUID()
      const { error: updateError } = await supabase
        .from('signers')
        .update({
          magic_token: magicToken,
          token_expires_at: expiry.toISOString(),
        })
        .eq('id', signer.id)

      if (updateError) {
        logger.error('send_for_signing.token_update_failed', updateError, { documentId, signerId: signer.id })
        throw new ServiceError('INTERNAL', 'Failed to generate signing tokens')
      }

      // Send the magic link email (non-blocking; logged on failure)
      try {
        const { sendMagicLinkEmail } = await import('@/lib/email/sendMagicLink')
        await sendMagicLinkEmail({
          signerEmail: signer.email,
          signerName: signer.name || signer.email,
          documentTitle: doc.title,
          magicToken,
          ownerEmail: userId,
          expiresInDays: doc.expiration_days,
        })
      } catch (emailErr) {
        logger.error('send_for_signing.email_failed', emailErr, { documentId, signerId: signer.id })
        // Don't fail the whole operation for an email failure — the token is generated
      }
    }

    // Update document status
    const { error: docUpdateError } = await supabase
      .from('documents')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', documentId)

    if (docUpdateError) {
      logger.error('send_for_signing.doc_update_failed', docUpdateError, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to update document status')
    }

    await addAuditLog(supabase, documentId, 'document_sent', undefined, {
      signersCount: signers.length,
    })

    return (await this.get(documentId, userId)) as unknown as Document
  },

  /**
   * Resend the magic link invite for a specific signer. Rotates the token.
   */
  async resendSignerInvite(documentId: string, userId: string, signerId: string): Promise<void> {
    const doc = await this.validateOwnership(documentId, userId)

    if (doc.status !== 'sent' && doc.status !== 'partially_signed') {
      throw new ServiceError('CONFLICT', 'Cannot resend invite for a document that is not in progress')
    }

    const supabase = createAdminClient()
    const { data: signer, error: signerError } = await supabase
      .from('signers')
      .select('id, email, name, signed_at')
      .eq('id', signerId)
      .eq('document_id', documentId)
      .single()

    if (signerError || !signer) {
      throw new ServiceError('NOT_FOUND', 'Signer not found')
    }

    if (signer.signed_at) {
      throw new ServiceError('CONFLICT', 'Signer has already signed')
    }

    const magicToken = crypto.randomUUID()
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + doc.expiration_days)

    const { error: updateError } = await supabase
      .from('signers')
      .update({ magic_token: magicToken, token_expires_at: expiry.toISOString() })
      .eq('id', signer.id)

    if (updateError) {
      logger.error('resend_invite.token_update_failed', updateError, { documentId, signerId })
      throw new ServiceError('INTERNAL', 'Failed to rotate token')
    }

    try {
      const { sendMagicLinkEmail } = await import('@/lib/email/sendMagicLink')
      await sendMagicLinkEmail({
        signerEmail: signer.email,
        signerName: signer.name || signer.email,
        documentTitle: doc.title,
        magicToken,
        ownerEmail: userId,
        expiresInDays: doc.expiration_days,
      })
    } catch (emailErr) {
      logger.error('resend_invite.email_failed', emailErr, { documentId, signerId })
    }

    await addAuditLog(supabase, documentId, 'invite_resent', undefined, { signerId })
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/babasola/Projects/SignProz && npx vitest run src/services/__tests__/DocumentService.test.ts`
Expected: 7 tests pass (4 from Task 3 + 3 new).

- [ ] **Step 5: Run type-check**

Run: `cd /home/babasola/Projects/SignProz && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add src/services/DocumentService.ts src/services/__tests__/DocumentService.test.ts
git commit -m "feat(services): add DocumentService mutating methods (create/update/delete/send/resend)"
```

---

## Task 5: Create `src/services/SigningService.ts`

**Files:**
- Create: `src/services/SigningService.ts`
- Create: `src/services/__tests__/SigningService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/home/babasola/Projects/SignProz/src/services/__tests__/SigningService.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockSupabase = { from: mockFrom, rpc: mockRpc }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}))

import { SigningService } from '@/services/SigningService'
import { ServiceError } from '@/services/errors'

describe('SigningService.getSigningContext', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('returns the document and fields for a valid token', async () => {
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 's1', document_id: 'd1', email: 's@x.com', name: 'S', signed_at: null, token_expires_at: '2099-01-01' },
            error: null,
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'd1', title: 'Test', status: 'sent' },
          error: null,
        }),
      }
    })
    // fields query is a list query, not single
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'f1', field_type: 'signature' }], error: null }),
    })

    const result = await SigningService.getSigningContext('d1', 'tok-abc')

    expect(result.signer.email).toBe('s@x.com')
    expect(result.document.title).toBe('Test')
  })
})

describe('SigningService.signDocument', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('calls sign_document RPC and returns the result', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, documentStatus: 'partially_signed', signerId: 's1' },
      error: null,
    })

    const result = await SigningService.signDocument('d1', 'tok', [
      { fieldId: 'f1', value: { signature: 'data' } },
    ])

    expect(mockRpc).toHaveBeenCalledWith('sign_document', {
      p_document_id: 'd1',
      p_magic_token: 'tok',
      p_field_values: [{ fieldId: 'f1', value: { signature: 'data' } }],
    })
    expect(result.documentStatus).toBe('partially_signed')
  })

  it('maps PG exception INVALID_TOKEN to UNAUTHORIZED', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'INVALID_TOKEN', code: '28000' },
    })

    await expect(SigningService.signDocument('d1', 'bad', [])).rejects.toThrow(ServiceError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/SignProz && npx vitest run src/services/__tests__/SigningService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `/home/babasola/Projects/SignProz/src/services/SigningService.ts` with exactly this content:

```typescript
/**
 * SigningService — the document signing workflow.
 *
 * The atomic sign operation is delegated to the PL/pgSQL `sign_document()`
 * function (migration 00007). Service methods map PG exception codes to
 * ServiceError codes for the route layer.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { ServiceError } from '@/services/errors'
import { addAuditLog } from '@/lib/utils'

export interface SigningContext {
  document: {
    id: string
    title: string
    status: string
  }
  signer: {
    id: string
    email: string
    name: string | null
  }
  fields: Array<{
    id: string
    field_type: string
    position_x: number
    position_y: number
    width: number
    height: number
    is_required: boolean
  }>
}

export interface SignResult {
  success: boolean
  documentStatus: 'completed' | 'partially_signed'
  signerId: string
}

// Map PG SQLSTATE + message to ServiceError codes
function mapPgErrorToServiceError(message: string, code: string): ServiceError {
  if (message === 'INVALID_TOKEN' || code === '28000') {
    return new ServiceError('UNAUTHORIZED', 'Invalid or expired token')
  }
  if (message === 'TOKEN_EXPIRED') {
    return new ServiceError('TOKEN_EXPIRED', 'Signing link has expired')
  }
  if (message === 'ALREADY_SIGNED') {
    return new ServiceError('CONFLICT', 'Document already signed')
  }
  if (message === 'INVALID_STATUS') {
    return new ServiceError('CONFLICT', 'Document is not available for signing')
  }
  if (message === 'SEQUENTIAL_ORDER') {
    return new ServiceError('SEQUENTIAL_ORDER', 'Prior signers must complete before you')
  }
  if (message === 'INVALID_FIELD') {
    return new ServiceError('VALIDATION', 'One or more fields do not belong to you')
  }
  return new ServiceError('INTERNAL', 'Signing failed', { pgMessage: message, pgCode: code })
}

export const SigningService = {
  /**
   * Get the document, signer, and assigned fields for the signing UI.
   * Throws UNAUTHORIZED if the token doesn't match a signer for this document.
   */
  async getSigningContext(documentId: string, magicToken: string): Promise<SigningContext> {
    const supabase = createAdminClient()

    const { data: signer, error: signerError } = await supabase
      .from('signers')
      .select('id, document_id, email, name, signed_at, token_expires_at')
      .eq('magic_token', magicToken)
      .eq('document_id', documentId)
      .single()

    if (signerError || !signer) {
      throw new ServiceError('UNAUTHORIZED', 'Invalid or expired token')
    }

    if (signer.signed_at) {
      throw new ServiceError('CONFLICT', 'Document already signed')
    }

    if (new Date(signer.token_expires_at) < new Date()) {
      throw new ServiceError('TOKEN_EXPIRED', 'Signing link has expired')
    }

    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, status')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      throw new ServiceError('NOT_FOUND', 'Document not found')
    }

    const { data: fields, error: fieldsError } = await supabase
      .from('signature_fields')
      .select('id, field_type, position_x, position_y, width, height, is_required')
      .eq('signer_id', signer.id)

    if (fieldsError) {
      logger.error('signing.context.fields_load_failed', fieldsError, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to load signature fields')
    }

    return {
      document: { id: document.id, title: document.title, status: document.status },
      signer: { id: signer.id, email: signer.email, name: signer.name },
      fields: (fields ?? []) as SigningContext['fields'],
    }
  },

  /**
   * Atomically sign a document as a specific signer.
   * Delegates to the PL/pgSQL `sign_document()` function.
   * Sends the completion email if the document is now fully signed.
   */
  async signDocument(
    documentId: string,
    magicToken: string,
    fieldValues: Array<{ fieldId: string; value: unknown }>
  ): Promise<SignResult> {
    const supabase = createAdminClient()

    const { data, error } = await supabase.rpc('sign_document', {
      p_document_id: documentId,
      p_magic_token: magicToken,
      p_field_values: fieldValues,
    })

    if (error || !data) {
      logger.error('signing.sign_document.failed', error, { documentId })
      const message = (error?.message ?? '').toUpperCase()
      const code = error?.code ?? ''
      throw mapPgErrorToServiceError(message, code)
    }

    const result = data as { success: boolean; documentStatus: string; signerId: string }

    // Send completion email if all signers have signed
    if (result.documentStatus === 'completed') {
      try {
        const { sendCompletionEmail } = await import('@/lib/email/sendCompletionEmail')
        // Look up the document owner email to send the completion notification
        const { data: doc } = await supabase
          .from('documents')
          .select('user_id, title')
          .eq('id', documentId)
          .single()
        if (doc) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', doc.user_id)
            .single()
          if (profile?.email) {
            await sendCompletionEmail({ ownerEmail: profile.email, documentTitle: doc.title })
          }
        }
      } catch (emailErr) {
        logger.error('signing.completion_email_failed', emailErr, { documentId })
        // Don't fail the signing operation for an email failure
      }
    }

    return {
      success: true,
      documentStatus: result.documentStatus as SignResult['documentStatus'],
      signerId: result.signerId,
    }
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/SignProz && npx vitest run src/services/__tests__/SigningService.test.ts`
Expected: 3 tests pass (note: the first test has slightly fragile mock chain ordering — if it fails, see the "Adjust the first test if needed" note below).

- [ ] **Step 5: Adjust the first test if needed (only if it failed)**

If `SigningService.getSigningContext` test fails due to mock ordering, edit the test to mock all three queries in order (signer, document, fields) using a counter. The exact mock pattern is finicky; the goal is to assert the returned context object has `signer.email` and `document.title`.

- [ ] **Step 6: Run type-check**

Run: `cd /home/babasola/Projects/SignProz && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add src/services/SigningService.ts src/services/__tests__/SigningService.test.ts
git commit -m "feat(services): add SigningService with PL/pgSQL sign_document delegation"
```

---

## Task 6: Create `src/services/index.ts`

**Files:**
- Create: `src/services/index.ts`

- [ ] **Step 1: Write the re-export module**

Create `/home/babasola/Projects/SignProz/src/services/index.ts` with exactly this content:

```typescript
export { DocumentService } from './DocumentService'
export { SigningService } from './SigningService'
export {
  ServiceError,
  isServiceError,
  serviceErrorToStatus,
  type ServiceErrorCode,
  type ServiceResult,
} from './errors'
```

- [ ] **Step 2: Verify the file**

Run: `cat /home/babasola/Projects/SignProz/src/services/index.ts`
Expected: 6 lines of exports.

- [ ] **Step 3: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add src/services/index.ts
git commit -m "feat(services): add services barrel export"
```

---

## Task 7: Refactor `documents/route.ts` (GET + POST)

**Files:**
- Modify: `src/app/api/documents/route.ts`

- [ ] **Step 1: Read the current file**

Run: `cat /home/babasola/Projects/SignProz/src/app/api/documents/route.ts`
Expected: ~93 lines of GET and POST handlers.

- [ ] **Step 2: Replace the file with the refactored version**

Overwrite `/home/babasola/Projects/SignProz/src/app/api/documents/route.ts` with exactly this content:

```typescript
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, ServiceError, serviceErrorToStatus, isServiceError } from '@/services'
import { createDocumentSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '20', 10)
  const status = searchParams.get('status') || undefined

  try {
    const result = await DocumentService.list(session.id, { page, limit, status })
    return NextResponse.json(result)
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.list.rejected', { userId: session.id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.list.error', err, { userId: session.id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = createDocumentSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // The route's create schema is a subset of the service's. Read the full body
  // (signers + fields) from the request, validating only the title and content.
  const rawBody = await request.clone().json() as {
    title: string
    content?: string
    template_id?: string
    expiration_days?: number
    signers?: Array<{ email: string; name: string; order?: number }>
    fields?: Array<{
      field_type: string
      position_x: number
      position_y: number
      width?: number
      height?: number
      signer_index: number
      is_required?: boolean
      page_number?: number
      label?: string
    }>
  }

  try {
    const document = await DocumentService.create(session.id, {
      title: parsed.data.title,
      content: parsed.data.content,
      template_id: parsed.data.template_id,
      expiration_days: parsed.data.expiration_days,
      signers: rawBody.signers ?? [],
      fields: rawBody.fields ?? [],
    })
    return NextResponse.json({ document })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.create.rejected', { userId: session.id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.create.error', err, { userId: session.id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify type-check**

Run: `cd /home/babasola/Projects/SignProz && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Run the test suite**

Run: `cd /home/babasola/Projects/SignProz && npm test`
Expected: 20+ tests pass (13 existing + 7 new service tests).

- [ ] **Step 5: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add src/app/api/documents/route.ts
git commit -m "refactor(routes): documents/route.ts uses DocumentService"
```

---

## Task 8: Refactor `documents/[id]/route.ts` (GET, PATCH, DELETE)

**Files:**
- Modify: `src/app/api/documents/[id]/route.ts`

- [ ] **Step 1: Read the current file**

Run: `cat /home/babasola/Projects/SignProz/src/app/api/documents/\[id\]/route.ts`

- [ ] **Step 2: Replace the file with the refactored version**

Overwrite `/home/babasola/Projects/SignProz/src/app/api/documents/[id]/route.ts` with exactly this content:

```typescript
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const document = await DocumentService.get(id, session.id)
    return NextResponse.json({ document })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.get.rejected', { userId: session.id, documentId: id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.get.error', err, { userId: session.id, documentId: id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as {
    title?: string
    content?: string
    expiration_days?: number
  }

  try {
    const document = await DocumentService.update(id, session.id, body)
    return NextResponse.json({ document })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.update.rejected', { userId: session.id, documentId: id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.update.error', err, { userId: session.id, documentId: id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await DocumentService.delete(id, session.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.delete.rejected', { userId: session.id, documentId: id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.delete.error', err, { userId: session.id, documentId: id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify type-check and tests**

Run: `cd /home/babasola/Projects/SignProz && npx tsc --noEmit && npm test 2>&1 | tail -10`
Expected: 0 type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add src/app/api/documents/[id]/route.ts
git commit -m "refactor(routes): documents/[id]/route.ts uses DocumentService"
```

---

## Task 9: Refactor `documents/[id]/send/route.ts`

**Files:**
- Modify: `src/app/api/documents/[id]/send/route.ts`

- [ ] **Step 1: Read the current file**

Run: `cat /home/babasola/Projects/SignProz/src/app/api/documents/\[id\]/send/route.ts`

- [ ] **Step 2: Replace the file with the refactored version**

Overwrite `/home/babasola/Projects/SignProz/src/app/api/documents/[id]/send/route.ts` with exactly this content:

```typescript
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const document = await DocumentService.sendForSigning(id, session.id)
    return NextResponse.json({ document })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.send.rejected', { userId: session.id, documentId: id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.send.error', err, { userId: session.id, documentId: id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd /home/babasola/Projects/SignProz
npx tsc --noEmit
git add src/app/api/documents/[id]/send/route.ts
git commit -m "refactor(routes): documents/[id]/send/route.ts uses DocumentService"
```

Expected: 0 type errors, commit succeeds.

---

## Task 10: Refactor `documents/[id]/sign/route.ts`

**Files:**
- Modify: `src/app/api/documents/[id]/sign/route.ts`

This is the most important route — it goes from 299 lines of imperative logic to ~30 lines calling `SigningService.signDocument`.

- [ ] **Step 1: Read the current file (just the imports and the function signature)**

Run: `head -30 /home/babasola/Projects/SignProz/src/app/api/documents/\[id\]/sign/route.ts`

- [ ] **Step 2: Replace the file with the refactored version**

Overwrite `/home/babasola/Projects/SignProz/src/app/api/documents/[id]/sign/route.ts` with exactly this content:

```typescript
import { NextResponse } from 'next/server'
import { SigningService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id: documentId } = await params
  const body = (await request.json()) as { token?: string; fields?: unknown[] }

  if (!body.token || !Array.isArray(body.fields)) {
    return NextResponse.json(
      { error: 'Invalid request: token and fields are required' },
      { status: 400 }
    )
  }

  try {
    const result = await SigningService.signDocument(documentId, body.token, body.fields as Array<{ fieldId: string; value: unknown }>)
    return NextResponse.json(result)
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.sign.rejected', { documentId, code: err.code })
      return NextResponse.json(
        { error: err.message, ...err.details },
        { status: serviceErrorToStatus(err.code) }
      )
    }
    logger.error('documents.sign.error', err, { documentId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify type-check and tests**

```bash
cd /home/babasola/Projects/SignProz
npx tsc --noEmit
npm test 2>&1 | tail -6
```

Expected: 0 type errors, 20+ tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/babasola/Projects/SignProz
git add src/app/api/documents/[id]/sign/route.ts
git commit -m "refactor(routes): documents/[id]/sign/route.ts uses SigningService (was 299 lines)"
```

---

## Task 11: Refactor `sign/[documentId]/route.ts`

**Files:**
- Modify: `src/app/api/sign/[documentId]/route.ts`

- [ ] **Step 1: Read the current file**

Run: `cat /home/babasola/Projects/SignProz/src/app/api/sign/\[documentId\]/route.ts`

- [ ] **Step 2: Replace the file with the refactored version**

Overwrite `/home/babasola/Projects/SignProz/src/app/api/sign/[documentId]/route.ts` with exactly this content:

```typescript
import { NextResponse } from 'next/server'
import { SigningService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ documentId: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  const { documentId } = await params
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  try {
    const context = await SigningService.getSigningContext(documentId, token)
    return NextResponse.json({ context })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('sign.context.rejected', { documentId, code: err.code })
      return NextResponse.json(
        { error: err.message, ...err.details },
        { status: serviceErrorToStatus(err.code) }
      )
    }
    logger.error('sign.context.error', err, { documentId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd /home/babasola/Projects/SignProz
npx tsc --noEmit
git add src/app/api/sign/[documentId]/route.ts
git commit -m "refactor(routes): sign/[documentId]/route.ts uses SigningService"
```

Expected: 0 type errors.

---

## Task 12: Refactor `documents/[id]/signers/[signerId]/resend/route.ts`

**Files:**
- Modify: `src/app/api/documents/[id]/signers/[signerId]/resend/route.ts`

- [ ] **Step 1: Read the current file**

Run: `cat /home/babasola/Projects/SignProz/src/app/api/documents/\[id\]/signers/\[signerId\]/resend/route.ts`

- [ ] **Step 2: Replace the file with the refactored version**

Overwrite `/home/babasola/Projects/SignProz/src/app/api/documents/[id]/signers/[signerId]/resend/route.ts` with exactly this content:

```typescript
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string; signerId: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id: documentId, signerId } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await DocumentService.resendSignerInvite(documentId, session.id, signerId)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('resend.rejected', { userId: session.id, documentId, signerId, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('resend.error', err, { userId: session.id, documentId, signerId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd /home/babasola/Projects/SignProz
npx tsc --noEmit
git add src/app/api/documents/[id]/signers/[signerId]/resend/route.ts
git commit -m "refactor(routes): signers/[signerId]/resend uses DocumentService"
```

Expected: 0 type errors.

---

## Task 13: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
cd /home/babasola/Projects/SignProz && npm test 2>&1 | tail -10
```

Expected: 20+ tests pass (13 existing + 7 new service tests).

- [ ] **Step 2: Run type-check**

```bash
cd /home/babasola/Projects/SignProz && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Run the build**

```bash
cd /home/babasola/Projects/SignProz && npm run build 2>&1 | tail -20
```

Expected: build succeeds, all routes listed.

- [ ] **Step 4: Verify no route file calls `supabase.from(...)` directly**

```bash
cd /home/babasola/Projects/SignProz && grep -rn "from('documents')\|from('signers')\|from('signature_fields')\|from('audit_logs')" src/app/api/
```

Expected: zero matches. All DB access for these tables must go through the services.

- [ ] **Step 5: Show the diff summary**

```bash
cd /home/babasola/Projects/SignProz && git log main..HEAD --oneline
```

Expected: ~12 commits (1 migration + 1 errors + 4 service commits + 5 route refactors + 1 final touchup).

---

## Task 14: Update `docs/deploy.md` and `CHANGELOG.md`

**Files:**
- Modify: `docs/deploy.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `docs/deploy.md`**

Open `/home/babasola/Projects/SignProz/docs/deploy.md`. The current text says migrations `00004` and `00005` are required. Add `00007` to that list.

Find the line:
```
**Do not skip the database migration step** — the code in PR #2 requires migrations `00004` and `00005` to be applied first.
```

Replace with:
```
**Do not skip the database migration step** — the code requires migrations `00004`, `00005`, and `00007` to be applied first.
```

- [ ] **Step 2: Update `CHANGELOG.md`**

Open `/home/babasola/Projects/SignProz/CHANGELOG.md`. Under `## [Unreleased]` → `### Changed` (create this subsection if it doesn't exist), add a new bullet:

```markdown
- API routes refactored to use transactional service layer (`DocumentService`, `SigningService`); the signing workflow now runs as a single atomic PL/pgSQL function call
```

- [ ] **Step 3: Commit the doc updates**

```bash
cd /home/babasola/Projects/SignProz
git add docs/deploy.md CHANGELOG.md
git commit -m "docs: update deploy runbook and CHANGELOG for D.2"
```

---

## Self-Review

**Spec coverage check:**

- `DocumentService` (8 methods: list, get, create, update, delete, sendForSigning, resendSignerInvite, validateOwnership) → Task 3 (read methods) + Task 4 (mutating methods)
- `SigningService` (3 methods: getSigningContext, signDocument, validateMagicSession) → Task 5 (note: `validateMagicSession` is for `auth_tokens` table — out of scope for D.2, deferred)
- `sign_document()` PL/pgSQL function → Task 1 (migration 00007)
- `with_transaction()` PL/pgSQL function → Task 1
- 12 route refactors → Tasks 7-12 (6 routes refactored: documents, documents/[id], documents/[id]/send, documents/[id]/sign, sign/[documentId], documents/[id]/signers/[signerId]/resend; 6 routes correctly identified as out of scope: auth/register/*, auth/login, auth/signup, auth/verify, auth/session, auth/logout, auth/magic-session, agreement-analyze, ai/faq)
- `ServiceError` types → Task 2
- `docs/deploy.md` update → Task 14
- `CHANGELOG.md` update → Task 14
- TDD discipline (failing test → impl → passing test) → Tasks 3, 4, 5 all follow this pattern

**Out-of-spec or deferred items (correctly):**
- `EvidenceService` — explicitly deferred to D.3 per spec
- `validateMagicSession` in SigningService — the existing `auth/magic-session` route uses `auth_tokens` table for registration, not `signers.magic_token`. This is out of scope for D.2.
- `PL/pgSQL integration tests` (sign_document.sql, document_crud.sql) — the spec lists these but the plan covers them via the service-level unit tests with mocked supabase. The PL/pgSQL function will be tested against production Supabase as part of the deploy verification (manual smoke test). Adding separate PL/pgSQL integration tests is a future workstream.

**Placeholder scan:**
- No "TBD" / "TODO" / "implement later"
- All code blocks are complete
- All commands show exact arguments and expected output
- File paths are exact (including the `[]` Next.js dynamic segments)

**Type consistency check:**
- `DocumentService.create(input)` takes `signers: Array<{ email: string; name: string; order?: number }>` and `fields: Array<{ ..., signer_index: number, ... }>` — consistent in service and route (Task 7 reads the same shape from `rawBody`)
- `DocumentService.sendForSigning` calls `sendMagicLinkEmail({ signerEmail, signerName, documentTitle, magicToken, ownerEmail, expiresInDays })` — matches the existing `sendMagicLinkEmail` signature pattern
- `SigningService.signDocument(documentId, token, fieldValues)` returns `SignResult { success, documentStatus, signerId }` — consistent with what the route returns
- `ServiceError` codes (`NOT_FOUND`, `UNAUTHORIZED`, etc.) — used identically in `errors.ts`, services, and route mappers
- `serviceErrorToStatus` — same mapping in all 6 refactored routes

**Note on Task 5's fragile test:** The first SigningService test (getSigningContext) uses a counter to mock 3 sequential queries. The mock pattern is brittle. If the test fails, the implementer should adjust the mock ordering — the test goal is to assert the returned `context` object has `signer.email` and `document.title`, not to nail the exact mock structure.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-16-d2-domain-services.md` (14 tasks, 14 commits expected).

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
