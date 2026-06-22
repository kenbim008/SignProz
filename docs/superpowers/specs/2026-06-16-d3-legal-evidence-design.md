# D.3 — Legal Evidence Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every signed document legally defensible (eIDAS, ESIGN, UETA) by anchoring it to a tamper-evident audit chain, content hashes, an RFC 3161 timestamp, and a self-hosted transparency log — and exposing all of this via a public certificate of completion and a verification page.

**Architecture:** Four concentric layers of integrity, each catching attacks the others miss. A PL/pgSQL trigger computes and verifies the audit chain on every row write (bypass-proof). A new `EvidenceService` owns hashing, certificate issuance, and chain verification. A Vercel Cron appends a daily Merkle root to an append-only Vercel Blob log. Signers get a PDF + JSON manifest certificate; anyone with the cert ID can verify the chain via a public `/verify/[id]` page.

**Tech Stack:** Next.js 16.2.4 (App Router), TypeScript, Supabase PostgreSQL with PL/pgSQL, `node:crypto` for SHA-256, `pdf-lib` for PDF generation, `@vercel/blob` for storage, Vercel Cron, FreeTSA.org for RFC 3161 timestamps, Vitest for tests, `pg_prove` for PL/pgSQL tests.

---

## Background

D.1 shipped deploy/secrets/observability. D.2 extracted `DocumentService` and `SigningService` and added the `sign_document()` PL/pgSQL function. The `audit_logs` table is append-only (no DELETE grant) and has these actions already firing from D.2: `document_created`, `document_updated`, `document_deleted`, `document_sent`, `signer_resend_link`, `signer_signed`, `document_completed`, `signer_completed_sequential`.

What's missing for legal defensibility:

1. **Tamper evidence on the chain itself.** A privileged DB user could UPDATE a row's `metadata` and there's no way to detect it. The chain needs a hash linking each row to the previous.
2. **Content integrity.** The audit log records *what happened* but not *what was signed*. The certificate must include a hash of the document content at the moment of completion.
3. **Independent witness.** An attacker with DB access could rewrite both the chain and the chain-verification function. We need an off-database anchor: a per-document RFC 3161 timestamp plus a daily Merkle root in an append-only log.
4. **A user-facing artifact.** Owners and recipients need a certificate of completion that they can download, print, and hand to a court.
5. **A public verification surface.** Anyone with the cert ID should be able to verify the chain themselves, without needing an account.

---

## Architecture: Four Layers of Integrity

1. **Hash chain on `audit_logs`.** Every row carries `prev_hash` and `hash = SHA-256(prev_hash || canonical_json(this_row))`. A PL/pgSQL trigger computes both. The chain is partitioned by `document_id` so each document has its own chain and verification is per-document.

2. **Content hashes on `documents`.** At send-time: `content_hash_at_send`. At completion: `content_hash_at_completion`. Both computed by `EvidenceService` from canonicalized content.

3. **Per-document RFC 3161 timestamp.** At completion, a TSA response from FreeTSA is stored as `tst_token BYTEA` on the certificate row. Each cert stands alone as evidence.

4. **Daily Merkle root in a self-hosted transparency log.** A Vercel Cron appends a chained entry to an append-only Vercel Blob log once a day. The log itself is hash-chained. Independent witness.

All four layers are independent. An attacker who tampers with one row is caught by layer 1. An attacker who replaces a document row is caught by layer 2. An attacker who backdates a completion is caught by layer 3. An attacker who rewrites history is caught by layer 4.

---

## Components

### 1. Migration `00008_legal_evidence.sql`

All statements idempotent (`CREATE OR REPLACE` / `DROP IF EXISTS`).

**`audit_logs` gains three columns:**
- `prev_hash BYTEA` — hash of the previous row in this document's chain (NULL for the first row)
- `hash BYTEA` — SHA-256 of `prev_hash || canonical_json(this_row)`, computed by trigger
- `chain_key TEXT GENERATED ALWAYS AS (document_id::text) STORED` — partitions the chain by document

**Two triggers on `audit_logs`:**
- `audit_logs_compute_hash` (BEFORE INSERT): looks up the latest `hash` for the same `document_id` (or NULL if first), sets `prev_hash`, computes `hash = SHA-256(prev_hash || canonical_json(NEW))`.
- `audit_logs_verify_js_hash` (BEFORE INSERT, when the JS layer pre-computes the hash for defense in depth): if `NEW.hash` is already set, the trigger recomputes the expected hash and rejects with `HASH_MISMATCH` if they differ. The trigger rejects any attempt to set `prev_hash` directly (only the trigger may set it).

**`documents` gains three columns:**
- `content_hash_at_send BYTEA` — set by `DocumentService.sendForSigning` when status goes draft → sent
- `content_hash_at_completion BYTEA` — set by the `sign_document` PL/pgSQL function (migration 00007's function, extended) when the last signer signs
- `completion_merkle_root BYTEA` — Merkle root of the audit chain at the moment of completion

**New `certificates` table:**
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (also the public cert ID)
- `document_id UUID NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE` — one cert per document
- `content_hash_at_send BYTEA NOT NULL`
- `content_hash_at_completion BYTEA NOT NULL`
- `chain_root_hash BYTEA NOT NULL` — final hash in the document's audit chain at completion
- `tst_token BYTEA` — RFC 3161 timestamp response (NULL until TSA returns)
- `merkle_root_at_completion BYTEA` — snapshot of the daily transparency-log root covering this completion
- `pdf_storage_path TEXT` — Vercel Blob path
- `json_manifest JSONB NOT NULL` — embedded audit chain + content hashes + signers for offline verification
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `tsa_issued_at TIMESTAMPTZ` (NULL until Phase B completes)

RLS: owners can SELECT their own cert; anyone can SELECT (cert ID is treated as a capability — knowing the ID is the auth). INSERT/UPDATE/DELETE are service-role only.

**New `evidence_log_entries` table** — the self-hosted transparency log. One row per day:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `log_date DATE UNIQUE NOT NULL`
- `merkle_root BYTEA NOT NULL`
- `entry_count INT NOT NULL`
- `prev_log_hash BYTEA` — chains the log itself
- `log_hash BYTEA` — SHA-256 of `prev_log_hash || merkle_root || entry_count || log_date`
- `rekor_entry_id TEXT` — optional, set if we also submit to Sigstore Rekor
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

**Helper PL/pgSQL functions:**
- `canonical_audit_json(p_row audit_logs) RETURNS TEXT` — stable JSON representation of an audit row for hashing. Sorts all keys alphabetically, normalizes timestamps to ISO 8601 UTC, omits `prev_hash` and `hash` themselves (we hash the data, not the chain pointers).
- `verify_document_audit_chain(p_document_id UUID) RETURNS TABLE(ok BOOLEAN, broken_at UUID, expected_hash BYTEA, actual_hash BYTEA)` — walks the chain in `created_at` order, returns the first row that fails verification (or empty if all good).
- `merkle_root_for_document(p_document_id UUID) RETURNS BYTEA` — computes the Merkle root of all audit entries for a document. Uses SHA-256 of `left_hash || right_hash` at each level; for odd-numbered levels, the last node is promoted unchanged.
- `daily_merkle_root(p_date DATE) RETURNS BYTEA` — Merkle root of all audit entries from the 24h period ending at the start of `p_date` (UTC).

### 2. `src/services/EvidenceService.ts`

The single service that owns all evidence concerns.

**Methods:**

- `hashContent(canonical: string): Buffer` — SHA-256 of canonicalized content using `node:crypto`. Returns a 32-byte buffer.
- `canonicalizeContent(content: string | null): string` — trims, normalizes line endings to `\n`, strips trailing whitespace, returns a stable string. Used before hashing.
- `canonicalizeAuditRow(row: AuditLogRow): string` — stable JSON via a deterministic key-order stringify.
- `verifyDocumentChain(documentId: string): Promise<{ ok: true } | { ok: false; brokenAt: string; expected: string; actual: string }>` — calls the PL/pgSQL function and shapes the result.
- `getCertificate(documentId: string): Promise<Certificate | null>` — fetches the cert row.
- `issueCertificate(documentId: string): Promise<Certificate>` — called from `SigningService` when a doc completes. See Data Flow below.
- `verifyCertificate(certificateId: string): Promise<VerificationResult>` — for the public verification page. See Data Flow below.
- `appendDailyLogEntry(date: Date): Promise<void>` — called by the daily Vercel Cron.
- `requestTimestamp(certId: string): Promise<Buffer>` — Phase B helper; calls FreeTSA, returns the token. Retries with exponential backoff up to 3 times, then returns the buffer it got (or throws `TSA_UNAVAILABLE` after the third failure).
- `renderCertificatePdf(cert: Certificate, manifest: JsonManifest): Promise<Buffer>` — uses `pdf-lib` to render the PDF (sync within the function). Pages: cover (title, doc ID, completion date), signers (name, email, signed_at, IP), content hashes, audit chain summary.

### 3. UI / routes

- `GET /api/documents/[id]/certificate` — owner-authenticated. Returns the JSON manifest. 404 if no cert exists.
- `GET /api/documents/[id]/certificate.pdf` — owner-authenticated. Streams the PDF from Vercel Blob.
- `GET /verify/[certificateId]` — **public, no auth required**. Server component that calls `EvidenceService.verifyCertificate` and renders the result.
- `GET /api/cron/daily-evidence-log` — Vercel Cron endpoint, gated by `CRON_SECRET` header (constant-time compare). Calls `EvidenceService.appendDailyLogEntry(new Date())`.
- `POST /api/cron/backfill-timestamps` — Vercel Cron endpoint (hourly), finds certs with `tst_token IS NULL`, retries the TSA request. Also retries any certs with `pdf_storage_path IS NULL` (Phase A upload failures).

**`vercel.json` change:** add a `crons` array with two entries:
- `{ "path": "/api/cron/daily-evidence-log", "schedule": "0 1 * * *" }` (01:00 UTC daily)
- `{ "path": "/api/cron/backfill-timestamps", "schedule": "0 * * * *" }` (hourly)

---

## Data Flow

### Signing completion → certificate issuance

When the last signer calls `signDocument()`:

1. `sign_document()` PL/pgSQL function (existing, from migration 00007, extended by this migration) updates the document to `status = 'completed'`, sets `completed_at`, sets `content_hash_at_completion`, and writes the `signer_signed` and `document_completed` audit log entries. The audit trigger automatically chains those entries.

2. **After the RPC returns**, `SigningService.signDocument` (modified) calls `EvidenceService.issueCertificate(documentId)`.

3. `issueCertificate` runs in three phases:

   **Phase A — synchronous (must complete before HTTP 200):**
   - Hash the document content (canonicalized final content with all fields filled in)
   - Verify the document's audit chain (defense: if the chain is broken, we don't issue a cert)
   - Compute the Merkle root of the document's audit chain
   - Look up the current daily Merkle root from `evidence_log_entries` (the most recent entry whose `log_date <= today`); if none, compute and insert one on the fly
   - Insert the `certificates` row with `tst_token = NULL`, `pdf_storage_path = NULL`
   - Build the JSON manifest (chain + hashes + signers + completion metadata)
   - Render the PDF
   - Upload PDF to Vercel Blob
   - UPDATE the cert row with `pdf_storage_path`, `json_manifest`, `merkle_root_at_completion`
   - Return the cert row

   **Phase B — async, fire-and-forget after responding (best-effort, retried hourly):**
   - Request the RFC 3161 timestamp from FreeTSA
   - On success: UPDATE the cert row with `tst_token` and `tsa_issued_at`
   - On failure: log; the hourly backfill cron retries

   **Phase C — once per day, by Vercel Cron at 01:00 UTC:**
   - Compute the Merkle root of all audit entries from the past 24h
   - Append to `evidence_log_entries`
   - Backfill any cert rows where `tst_token IS NULL` (the daily job picks up the slack if the hourly cron misses)

The signer sees the success response within Phase A timing. The TSA token and the next daily log entry land later — both are retroactive and the cert is still valid without them. The chain is the primary evidence; the TSA and log are the witness.

If FreeTSA is down for hours, completed documents are still legally valid — they just have `tst_token = NULL` in the row, which the verification page reports as "TSA pending" rather than "invalid."

### Public verification flow (`/verify/[certificateId]`)

1. Fetch the cert row by `id`. If not found, 404 with a generic message.
2. Walk the document's audit chain via `verifyDocumentChain` — catches tampering with the chain.
3. Verify the daily log hash for the entry whose `log_date >= cert.completion_date` — catches log rewriting.
4. Verify the RFC 3161 token against FreeTSA's public key (or cache the key) — catches backdating.
5. Render: `valid` (green) if all three checks pass; `partial` (yellow) if chain and log pass but TSA is missing; `invalid` (red) with the specific failure reason otherwise.

The page is fully public and renders server-side. No data about the document owner is shown beyond what the cert already contains.

---

## Error Handling

The service throws `ServiceError` (existing pattern from D.2). New codes specific to D.3:

- `INTEGRITY_FAILURE` — chain verification failed. Maps to HTTP 500. Generic "Evidence integrity check failed" message. **Never** returns the broken row ID or expected/actual hashes to the client — those go only to the log.
- `TSA_UNAVAILABLE` — Phase B timed out. **Not** thrown to the caller (Phase B is async). Cert row is left with `tst_token = NULL`. Hourly cron retries.
- `BLOB_UPLOAD_FAILED` — Phase A failed to upload the PDF. Thrown to the caller (the signer is informed). Cert is in a partial state; hourly cron retries the upload. Verification page reports "PDF unavailable, JSON manifest valid" in this case.
- `CERT_NOT_FOUND` — verification page requested a non-existent cert ID. Maps to HTTP 404 with a generic "Certificate not found" message (don't leak whether the cert was ever issued).

The route layer uses the existing `api-errors.ts` helper from D.2. The new error codes are added to `serviceErrorToStatus`:
- `INTEGRITY_FAILURE` → 500
- `BLOB_UPLOAD_FAILED` → 500 (the cert is still in a partial state, not the user's fault)
- `CERT_NOT_FOUND` → 404

---

## Testing

Four test layers, all TDD:

1. **Unit tests for `EvidenceService`** (Vitest) — hash determinism (same input → same output), canonicalization stability (whitespace, line endings, JSON key order), `verifyDocumentChain` against mocked SDK responses, `issueCertificate` phase ordering with mocked Blob + TSA. ~20 tests.
2. **PL/pgSQL tests** (a `supabase test db` script using `pg_prove` or a Vitest harness against a local Postgres). Verify the trigger computes hashes correctly, the trigger rejects bad chains, `verify_document_audit_chain` catches tampered rows. ~10 tests.
3. **Integration tests for routes** (Vitest + a real Supabase local instance) — `/api/documents/[id]/certificate` returns 200 with the manifest, `/verify/[id]` returns 200 for valid certs and 404 for unknown, cron endpoints reject requests without `CRON_SECRET`. ~8 tests.
4. **End-to-end happy path** (manual test script in `docs/test-scripts/TS-D3-EVIDENCE.md`) — sign a doc through the UI, verify the cert downloads, verify the `/verify/[id]` page says "valid", tamper with one row in a local DB and verify the page says "chain broken".

---

## Out of Scope (Explicit)

- **Migrating historical audit logs into the chain.** The chain starts at migration time. Pre-existing audit rows have `hash = NULL`. Acceptable because: (a) the chain only needs to be unbroken from migration forward, (b) any tampering with pre-migration rows is a separate audit concern handled by Supabase backups. If a one-time backfill is wanted, it's a follow-up.
- **Implementing a TSA client from scratch.** Use a small wrapper around `node-forge` for the RFC 3161 request/response. FreeTSA is the only TSA we hit.
- **Real-time chain verification on every read.** Verification is a deliberate action (the `/verify/[id]` page) and a daily cron check, not on every `DocumentService.get()`. Real-time verification on read would add latency to every dashboard page load.
- **Sigstore Rekor integration.** Mentioned in the architecture as a future enhancement, not built in this round. The self-hosted Vercel Blob log is the primary transparency log.
- **GDPR-style data minimization on audit metadata.** Logged events may include email addresses and IP addresses. If a future compliance review requires redaction of certain fields, that's a separate piece of work.

---

## Open Questions

None — all clarifying questions resolved during brainstorming.

---

## Success Criteria

- Migration 00008 applies cleanly to a fresh database and to a database that already has migration 00007 applied (idempotent).
- The PL/pgSQL trigger computes and verifies hashes on every `audit_logs` INSERT.
- An UPDATE on any audit_logs row in a local DB causes `verifyDocumentChain` to return `ok: false` with the broken row ID.
- Signing a document to completion produces a `certificates` row within the request round-trip.
- The PDF downloads from `/api/documents/[id]/certificate.pdf` and contains the title, signers, hashes, and completion date.
- `/verify/[id]` returns 200 with a green "valid" badge for an untampered cert, and a red "invalid" badge with the specific failure for a tampered one.
- The daily cron at 01:00 UTC appends a new `evidence_log_entries` row.
- The hourly cron backfills any missing `tst_token` values.
- All 38+ new tests pass. Type check, lint, build green.
