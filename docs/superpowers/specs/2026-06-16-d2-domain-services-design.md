# D.2 — Domain Service Extraction

**Date:** 2026-06-16
**Status:** Approved Design

---

## Goal

Move workflow logic out of API route handlers into transactional service modules. After D.2, route handlers will be thin shells (parse input, call service, format output). Multi-step business operations that touch multiple tables will run in Postgres transactions, eliminating the possibility of partial commits.

**Deferred to D.3:** `EvidenceService` (depends on the legal evidence model — document hashing, certificate of completion, audit chain).

---

## Scope

In scope:
- `DocumentService` — CRUD + send-for-signing + resend-invite workflows
- `SigningService` — sign workflow + magic-session validation
- `sign_document()` PL/pgSQL function — atomic multi-step signing
- 12 API route refactors — all routes become thin shells
- Service-level unit tests + one PL/pgSQL integration test
- New migration `00007_signing_workflow.sql`
- `docs/deploy.md` update to include the new migration step
- `CHANGELOG.md` entry under `[Unreleased]`

Out of scope (deferred):
- `EvidenceService` — D.3
- Background job for document expiration — separate workstream
- Audit chain hashing — D.3
- Test coverage expansion beyond the new services — separate workstream

---

## Architecture

```
src/
├── services/                      # NEW
│   ├── DocumentService.ts         # CRUD + send-for-signing workflow
│   ├── SigningService.ts          # Sign workflow (delegates to PL/pgSQL)
│   ├── errors.ts                  # ServiceError, ServiceResult<T> types
│   ├── index.ts                   # re-exports
│   └── __tests__/                 # service tests (mocked supabase client)
├── app/api/                       # MODIFIED — all routes become thin shells
└── lib/                           # UNCHANGED — supabase clients, email, logger

supabase/migrations/
└── 00007_signing_workflow.sql     # NEW — sign_document() PL/pgSQL function
```

**Boundary rule:** Routes parse input, call a service, format output. Services own all business logic, all DB calls, and all email triggers. Routes never call `supabase.from(...)` directly except for read-only auth checks (`getSession()`).

**Why PL/pgSQL for the sign workflow:** The current `sign` route does 8+ sequential DB calls (lookup signer, lookup document, lookup fields, validate, update fields, mark signed, update document status, write audit log). A failure mid-sequence leaves the database inconsistent. Moving this into a single stored function with `BEGIN/COMMIT/ROLLBACK` makes the whole operation atomic.

---

## Components

### `src/services/errors.ts` (~60 lines)

```typescript
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

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError }
```

### `src/services/DocumentService.ts` (~200 lines, 8 methods)

| Method | Purpose | DB ops | Returns |
|--------|---------|--------|---------|
| `list(userId, filters)` | Paginated dashboard list | `documents` SELECT | `{ documents, total, page, limit }` |
| `get(documentId, userId)` | Full document with signers, fields, audit | `documents` SELECT w/ joins | `DocumentDetail` |
| `create(userId, input)` | New doc + signers + fields in one transaction | INSERT x3 + audit log | `Document` |
| `update(documentId, userId, patch)` | Only if `status = 'draft'` | UPDATE + audit | `Document` |
| `delete(documentId, userId)` | Only if `status = 'draft'` | DELETE + audit | `void` |
| `sendForSigning(documentId, userId)` | draft → sent, generate tokens, send emails | UPDATE + INSERT tokens + multiple `sendMagicLinkEmail` | `Document` |
| `resendSignerInvite(documentId, userId, signerId)` | Rotate token, re-send | UPDATE token + sendMagicLinkEmail | `void` |
| `validateOwnership(documentId, userId)` | Internal — throws if not owner | SELECT | `void` |

**Transactional methods:** `create`, `update`, `delete`, `sendForSigning`, `resendSignerInvite` — all wrapped in `BEGIN/COMMIT/ROLLBACK` via the `sign_document` pattern below, or via a generic `withTransaction()` helper that uses `supabase.rpc('pg_transaction', { sql: '...' })`. For D.2, simpler: each transactional method calls a dedicated PL/pgSQL function (one per workflow) defined in `00007_signing_workflow.sql`.

**Email triggers:** `sendForSigning` and `resendSignerInvite` call into the existing `lib/email/sendMagicLink.ts` — no changes there.

**Audit emission:** Each mutating method calls `addAuditLog()` from `lib/utils.ts` inside the same transaction.

### `src/services/SigningService.ts` (~150 lines, 3 methods)

| Method | Purpose | DB ops | Returns |
|--------|---------|--------|---------|
| `getSigningContext(documentId, magicToken)` | Returns doc + assigned fields for signer UI | `documents` + `signers` + `signature_fields` SELECT | `SigningContext` |
| `signDocument(documentId, magicToken, fields)` | Atomic sign via PL/pgSQL | `supabase.rpc('sign_document', ...)` | `SignResult` |
| `validateMagicSession(token)` | Returns the signer + document for the magic-session route | `signers` + `documents` SELECT | `MagicSession` |

**The `signDocument` call** is the only one in the entire codebase that does multi-table work via PL/pgSQL. All other service methods use multiple JS-side SDK calls inside a wrapping `withTransaction()` helper (which is itself a thin PL/pgSQL function that does `BEGIN; ...; COMMIT;`).

### `supabase/migrations/00007_signing_workflow.sql` (~120 lines, 2 functions)

**Function 1: `sign_document(p_document_id UUID, p_magic_token TEXT, p_field_values JSONB)`**

```sql
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
  ELSE
    UPDATE documents SET status = 'partially_signed' WHERE id = p_document_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'documentStatus', CASE WHEN v_all_signed THEN 'completed' ELSE 'partially_signed' END,
    'signerId', v_signer.id
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE; -- Postgres auto-rolls back on exception
END;
$$;
```

**Function 2: `with_transaction(p_sql TEXT)`** — generic helper for JS-side transactional work. Used by `DocumentService.create`, `update`, `delete`, `sendForSigning`, `resendSignerInvite`.

```sql
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
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;
```

**Why a generic helper:** The other workflows (create document, send for signing) need transactions but don't have the same complex multi-step logic as signing. Composing multiple `INSERT/UPDATE` statements as a single SQL string keeps the workflow in TypeScript (easier to read, version-control, test) while still getting atomicity.

### Route refactors (12 files)

Each route becomes a thin shell. Example — `sign/route.ts` after D.2:

```typescript
import { SigningService } from '@/services'
import { logger } from '@/lib/logger'
import { ServiceError } from '@/services/errors'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params
  const body = await request.json()

  try {
    const result = await SigningService.signDocument(documentId, body.token, body.fields)
    return Response.json(result)
  } catch (err) {
    if (err instanceof ServiceError) {
      logger.warn('sign rejected', { code: err.code, documentId, ...err.details })
      const status = mapErrorToStatus(err.code)
      return Response.json({ error: err.message, ...err.details }, { status })
    }
    logger.error('sign failed', err, { documentId })
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}

function mapErrorToStatus(code: ServiceErrorCode): number {
  switch (code) {
    case 'NOT_FOUND': return 404
    case 'UNAUTHORIZED': return 401
    case 'FORBIDDEN': return 403
    case 'CONFLICT': return 409
    case 'VALIDATION': return 400
    case 'TOKEN_EXPIRED': return 410
    case 'SEQUENTIAL_ORDER': return 409
    default: return 500
  }
}
```

**Route-to-service mapping:**

| Route | Service method |
|-------|----------------|
| `documents/route.ts` GET | `DocumentService.list(userId, filters)` |
| `documents/route.ts` POST | `DocumentService.create(userId, body)` |
| `documents/[id]/route.ts` GET | `DocumentService.get(documentId, userId)` |
| `documents/[id]/route.ts` PATCH | `DocumentService.update(documentId, userId, body)` |
| `documents/[id]/route.ts` DELETE | `DocumentService.delete(documentId, userId)` |
| `documents/[id]/send/route.ts` | `DocumentService.sendForSigning(documentId, userId)` |
| `documents/[id]/signers/[signerId]/resend/route.ts` | `DocumentService.resendSignerInvite(documentId, userId, signerId)` |
| `sign/[documentId]/route.ts` | `SigningService.getSigningContext(documentId, token)` |
| `documents/[id]/sign/route.ts` | `SigningService.signDocument(documentId, token, fields)` |
| `auth/magic-session/route.ts` | `SigningService.validateMagicSession(token)` + Supabase session |

### Logger integration

Each service method:
- Logs entry: `logger.info('document.create.start', { userId })`
- Logs success: `logger.info('document.create.success', { userId, documentId })`
- Logs validation failures: `logger.warn('document.create.rejected', { userId, code: 'VALIDATION', ... })`
- Logs unexpected errors: `logger.error('document.create.error', err, { userId })`

Errors are still thrown so the route handler can map to HTTP status. The logger is for observability, not control flow.

---

## File Structure

```
src/services/
├── errors.ts                                # NEW (~60 lines)
├── DocumentService.ts                       # NEW (~200 lines)
├── SigningService.ts                        # NEW (~150 lines)
├── index.ts                                 # NEW (~10 lines)
└── __tests__/
    ├── DocumentService.test.ts              # NEW (~150 lines, 8 tests)
    ├── SigningService.test.ts               # NEW (~100 lines, 3 tests)
    └── integration/
        ├── sign_document.sql                # NEW (~40 lines, 1 PL/pgSQL test)
        └── document_crud.sql                # NEW (~60 lines, 1 PL/pgSQL test)

src/app/api/                                 # MODIFIED (all 12 files refactored)
supabase/migrations/
└── 00007_signing_workflow.sql               # NEW (~120 lines)

docs/
└── deploy.md                                # MODIFIED (add 00007 to migration list)

CHANGELOG.md                                 # MODIFIED (new entry)
```

**Total: ~700 lines of new code, ~150 lines removed from routes, ~30 lines of doc updates.**

---

## Implementation Order

1. **Migration `00007_signing_workflow.sql`** — must exist before any service code can call it
2. **`src/services/errors.ts`** — types needed by all services
3. **`DocumentService.ts`** + tests (8 methods, all read-only first, then mutating)
4. **`SigningService.ts`** + tests (3 methods)
5. **PL/pgSQL integration test** (`sign_document.sql`) — verifies the function works end-to-end
6. **Route refactors** — 12 files, one big commit
7. **Type-check, test, build** — all green
8. **`docs/deploy.md` + `CHANGELOG.md`** updates
9. **PR + Vercel preview** + production smoke test

Each step is a separate commit on `feature/d2-domain-services`.

---

## Verification Checklist

- [ ] Migration `00007_signing_workflow.sql` applied to production Supabase
- [ ] `sign_document()` function callable via `supabase.rpc('sign_document', ...)`
- [ ] All 13 existing tests still pass
- [ ] New service tests pass (11 total: 8 DocumentService + 3 SigningService)
- [ ] PL/pgSQL integration test passes
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] No route file calls `supabase.from(...)` directly (only `getSession()` for auth)
- [ ] Smoke test: full signup → create document → send → sign flow on Vercel preview returns 200
- [ ] `docs/deploy.md` updated
- [ ] `CHANGELOG.md` entry added

---

## What This Plan Does NOT Cover

- `EvidenceService` (D.3 — separate plan, depends on legal evidence model)
- Background job for document expiration
- Audit chain hashing (D.3)
- Test coverage expansion beyond the new services
- Performance optimization (e.g., query batching, caching) — separate workstream
- API versioning — not needed yet
