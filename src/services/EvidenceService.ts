/**
 * EvidenceService -- legal evidence model core read methods.
 *
 * Provides deterministic hashing (content canonicalization + SHA-256),
 * audit-chain verification (delegated to PL/pgSQL), and certificate
 * lookups. Used by the owner cert routes and the public verify page.
 *
 * All methods use createAdminClient() (service_role) for RPC calls,
 * skipping RLS. This matches the D.2 service pattern and is appropriate
 * because RPCs are SECURITY DEFINER functions. Caller auth is handled
 * at the route layer via api-errors.ts.
 */

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { ServiceError } from '@/services/errors'
import { canonicalizeContent, canonicalizeAuditRow } from '@/lib/canonicalize'
import { merkleRoot } from '@/lib/merkle'
import { logger } from '@/lib/logger'

export interface Certificate {
  id: string
  documentId: string
  contentHashAtSend: Buffer
  contentHashAtCompletion: Buffer
  chainRootHash: Buffer
  merkleRootAtCompletion: Buffer | null
  pdfStoragePath: string | null
  tstToken: Buffer | null
  createdAt: Date
  tsaIssuedAt: Date | null
}

export type VerificationResult =
  | { valid: true; chainOk: true; logOk: true; tsaOk: true; manifest: JsonManifest }
  | { valid: true; chainOk: true; logOk: true; tsaOk: false; tsaPending: true; manifest: JsonManifest }
  | { valid: false; failure: 'chain_broken' | 'log_missing' | 'log_broken' | 'cert_not_found'; details?: string }

export interface JsonManifest {
  documentId: string
  documentTitle: string
  completedAt: string
  signers: Array<{ name: string | null; email: string; signedAt: string | null }>
  auditChain: Array<{ action: string; actorEmail: string | null; createdAt: string; hash: string }>
  contentHashAtSend: string
  contentHashAtCompletion: string
}

export const EvidenceService = {
  /**
   * Deterministically hash content for the evidence model.
   * Canonicalizes (normalizes line endings, strips trailing whitespace,
   * handles null/undefined) before computing SHA-256.
   */
  hashContent(content: string | null | undefined): Buffer {
    const canonical = canonicalizeContent(content)
    return createHash('sha256').update(canonical, 'utf8').digest()
  },

  /**
   * Canonicalize an audit row into its stable JSON representation
   * for hashing. Delegates to canonicalizeAuditRow from the lib layer.
   */
  canonicalizeAuditRow(row: Record<string, unknown>): string {
    return canonicalizeAuditRow(row)
  },

  /**
   * Compute a SHA-256 Merkle root from a list of leaf hashes.
   * Delegates to merkleRoot from the lib layer.
   */
  merkleRootOfHashes(hashes: Buffer[]): Buffer {
    return merkleRoot(hashes)
  },

  /**
   * Verify the document's audit chain integrity via the
   * verify_document_audit_chain PL/pgSQL RPC.
   *
   * Returns { ok: true } if the chain is intact or has no rows.
   * Returns broken details if the RPC reports a hash mismatch.
   * Throws ServiceError on RPC failure.
   */
  async verifyDocumentChain(
    documentId: string,
  ): Promise<{ ok: true } | { ok: false; brokenAt: string; expected: string; actual: string }> {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('verify_document_audit_chain', {
      p_document_id: documentId,
    })

    if (error) {
      logger.error('evidence.verify_chain.rpc_failed', { documentId }, error)
      throw new ServiceError('INTERNAL', 'Failed to verify audit chain')
    }

    const row = data?.[0]
    if (!row || row.ok) return { ok: true }

    return {
      ok: false,
      brokenAt: row.broken_at,
      expected: row.expected_hash instanceof Buffer
        ? row.expected_hash.toString('hex')
        : String(row.expected_hash),
      actual: row.actual_hash instanceof Buffer
        ? row.actual_hash.toString('hex')
        : String(row.actual_hash),
    }
  },

  /**
   * Get the legal evidence certificate for a document.
   * Returns null when no certificate exists (caller decides HTTP status).
   */
  async getCertificate(documentId: string): Promise<Certificate | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('certificates')
      .select('*')
      .eq('document_id', documentId)
      .single()

    if (error || !data) return null
    return mapCertificate(data)
  },
}

function mapCertificate(row: Record<string, unknown>): Certificate {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    contentHashAtSend: row.content_hash_at_send as Buffer,
    contentHashAtCompletion: row.content_hash_at_completion as Buffer,
    chainRootHash: row.chain_root_hash as Buffer,
    merkleRootAtCompletion: (row.merkle_root_at_completion as Buffer) ?? null,
    pdfStoragePath: (row.pdf_storage_path as string) ?? null,
    tstToken: (row.tst_token as Buffer) ?? null,
    createdAt: new Date(row.created_at as string),
    tsaIssuedAt: row.tsa_issued_at ? new Date(row.tsa_issued_at as string) : null,
  }
}
