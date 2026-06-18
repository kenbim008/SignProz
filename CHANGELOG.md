# Changelog

All notable changes to SignProz are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security
- **BREAKING**: Replaced custom `sb-session` cookie with Supabase SSR sessions. Magic-link users will need to log in again on next visit.
- HTML content in documents is now sanitized via DOMPurify to prevent stored XSS
- Document signing is now server-enforced (required fields, sequential order)
- Rate limiting added to auth and AI endpoints

### Changed
- Removed false marketing claims about HIPAA, 400+ integrations, Microsoft 365
- Removed mock Stripe payout UI (replaced with "Coming Soon")
- Resolved schema drift: `profiles.email` populated via trigger, field types expanded
- API routes refactored to use a transactional service layer (`DocumentService`, `SigningService`); the signing workflow now runs as a single atomic PL/pgSQL function call

### Added
- `sign_document()` and `with_transaction()` PL/pgSQL functions (migration `00007`) for atomic multi-statement workflows
- `src/lib/api-errors.ts` helper: `apiErrorResponse()`, `apiError500()`, `apiUnauthorized()` — centralizes ServiceError → NextResponse mapping and remaps `FORBIDDEN` to `404` on document-scoped routes to prevent existence-vs-ownership info leak
- Legal evidence model (D.3): four-layer integrity — hash chain on `audit_logs`, content hashes on `documents`, per-document RFC 3161 timestamps, daily Merkle root in a self-hosted transparency log. New `EvidenceService` owns hashing, certificate issuance, and verification. New `/verify/[id]` public page lets anyone with a cert ID verify a document's chain. Daily Vercel Cron appends to the transparency log; hourly Cron backfills any missing TSA tokens.

### Fixed
- Information leak on `/documents/[id]/*` routes: a 403 vs 404 distinction was letting attackers probe whether a document exists by another user. The owner-authenticated document routes (`GET/PUT/PATCH/DELETE /documents/[id]`, `POST /documents/[id]/send`, `POST /documents/[id]/signers/[signerId]/resend`) now return 404 with a generic "Document not found" message when the requester doesn't own the document. The signing flow is intentionally NOT remapped — the signer is a different actor and the existence info is part of the public token UX.

### D.2.1 Follow-up (Deferred)

The D.2 work extracted domain services from API route handlers. The following items are intentionally deferred to a future D.2.1 (or D.2.2) release and are documented here so they are not lost:

- **`with_transaction()` is dead code.** The PL/pgSQL helper is defined in migration 00007 but no JS-side code calls it. `DocumentService.create()` still does three sequential SDK inserts (document, signers, fields) with no transaction wrapper, so a partial failure (e.g., fields insert errors after signers succeeded) can leave orphan signers attached to a half-built document. *Fix:* have `create()` call `with_transaction` and pass the three-step SQL, OR move the multi-insert into a single PL/pgSQL function.
- **DOMPurify lives in the route, not the service.** The HTML sanitization in `POST /api/documents` is performed in the route handler. The service layer should own this concern so any future caller (e.g., a CLI importer, a template engine) gets the same XSS protection. *Fix:* move `DOMPurify.sanitize` into `DocumentService.create()` / `update()`.
- **`sign_document` could return per-field errors.** The PL/pgSQL function throws `EMPTY_FIELD` / `SIGNATURE_TOO_LARGE` on the first violation. Returning a structured `missingFields: string[]` / `invalidFields: string[]` array would let the client highlight the specific empty/oversized fields in one round-trip. *Fix:* extend the function to collect all violations and return a JSON array in the response.
- **`getSigningContext` doesn't return derived fields.** The client has to compute `expiresAt` and `signerCount` from the returned data. *Fix:* add `expiresAt` and `signerCount` to the response.
- **Signers CRUD bypasses the service layer.** `POST/DELETE /documents/[id]/signers/[signerId]` still call `supabase.from('signers')` directly, with hand-rolled ownership checks and inconsistent error responses. *Fix:* add `SignerService.addSigner()` / `removeSigner()` to the service layer and refactor the routes to use it.
- **Fields CRUD bypasses the service layer.** `GET/POST/PUT/DELETE /documents/[id]/fields/[fieldId]` have the same pattern. *Fix:* add `FieldService.{list,create,update,delete}()` and refactor the routes.
- **`/api/auth/verify` is an API route that calls `redirect()`.** Next.js generally recommends server components for redirect-driven magic-link landing pages. *Fix:* either move to a server component at `/auth/verify/page.tsx` or keep as-is and add a test that the redirect is a 307 with the right Location header.
- **`with_transaction` is also useful for `sendForSigning`.** The token-generation loop, email sends, and document status update currently run as 2N+1 SDK calls with no transaction. A failure after some tokens are written leaves the document in a partial state. *Fix:* wrap the token generation + status update in `with_transaction`; the email sends can stay outside the transaction (they're idempotent and tracked via `emails_sent` / `partial_errors`).
- **No audit logging on read paths.** `DocumentService.get()` and `list()` don't write to `audit_logs`. For legal evidence (D.3), reads of completed documents may need to be logged. *Fix:* add a `document_viewed` audit log entry in `get()` when the document status is `sent` / `partially_signed` / `completed`.

## [0.1.0] - 2026-06-16

### Added
- Initial release: multi-step registration wizard (email → details → email OTP → phone OTP → password)
- Magic-link signing with reusable token infrastructure
- Document creation, signer invitations, sequential signing
- Vercel deployment with auto-deploy from `main`
- Supabase-backed auth and data layer
