# D.3 — Legal Evidence Manual Test

## Prerequisites
- A running local Supabase instance (`supabase start`)
- Migration 00008 applied (auto-applies on `supabase start`)
- Test user signed up
- A draft document with one signer

## Happy path

1. **Sign the document to completion** as the signer.
   - Expected: HTTP 200 from `/api/documents/[id]/sign`.
   - Expected: a `certificates` row exists in the database (check via Supabase Studio or `psql`).
2. **Fetch the JSON manifest** as the owner.
   ```
   curl -b cookies.txt https://localhost:3000/api/documents/[id]/certificate
   ```
   - Expected: HTTP 200 with `{ certificate: { id, contentHashAtSend, ..., jsonManifest } }`.
3. **Download the PDF** as the owner.
   ```
   curl -b cookies.txt https://localhost:3000/api/documents/[id]/certificate.pdf -o cert.pdf
   ```
   - Expected: a valid PDF file. Open in any viewer. The doc title and signers should be visible.
4. **Visit the public verification page** in an incognito window (no cookies).
   ```
   https://localhost:3000/verify/[certificateId]
   ```
   - Expected: a green "✓ Valid" panel. (TSA may say "Pending" if FreeTSA is slow.)

## Tamper test

5. **Edit an audit row in the local database** to simulate tampering:
   ```sql
   UPDATE audit_logs SET metadata = '{"tampered": true}' WHERE id = '<some row>';
   ```
6. **Reload the verification page.**
   - Expected: a red "✗ Invalid" panel with `Failure: chain_broken` and the broken row ID.

## Cleanup

7. **Restore the tampered row** (or just delete the local DB):
   ```bash
   supabase db reset
   ```
