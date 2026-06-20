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
import { canonicalizeContent } from '@/lib/canonicalize'
import { merkleRoot } from '@/lib/merkle'
import { toBuffer } from '@/lib/buffers'
import { logger } from '@/lib/logger'
import { put as blobPut } from '@vercel/blob'
import { renderCertificatePdf } from '@/lib/pdf/certificate'

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
  | { valid: true; chainOk: true; logOk: true; tsaOk: false; tsaTokenMissing: true; manifest: JsonManifest }
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

  /**
   * Look up a certificate by its primary key (cert id). Used by the
   * public verify page, which has the cert id from the URL but not the
   * document id. `getCertificate` looks up by `document_id` -- not what
   * the verify page needs.
   */
  async getCertificateById(certificateId: string): Promise<Certificate | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('certificates')
      .select('*')
      .eq('id', certificateId)
      .single()

    if (error || !data) return null
    return mapCertificate(data)
  },

  /**
   * Internal: fetch the raw certificates row by id, including the large
   * `json_manifest` JSONB column. Used by `verifyCertificate`, which needs
   * both the typed `Certificate` fields and the manifest in a single
   * round-trip. Returns the raw row + a mapped `Certificate` so callers
   * don't pay for a second SELECT to access the manifest.
   */
  async _getCertificateRowWithManifest(
    certificateId: string,
  ): Promise<{ cert: Certificate; manifest: JsonManifest } | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('certificates')
      .select('*')
      .eq('id', certificateId)
      .single()

    if (error || !data) return null
    const manifest = data.json_manifest as JsonManifest
    return { cert: mapCertificate(data), manifest }
  },

  /**
   * Verify a legal evidence certificate by checking:
   * 1. The certificate exists in the database
   * 2. The document's audit chain is intact
   * 3. A daily transparency-log entry covers the completion date AND its
   *    merkle_root is consistent with the audit_logs the appender saw
   *    on that day (i.e. the log has not been tampered with since
   *    `appendDailyLogEntry` ran).
   * 4. A TSA timestamp token exists (when applicable)
   */
  async verifyCertificate(certificateId: string): Promise<VerificationResult> {
    const supabase = createAdminClient()
    const result = await this._getCertificateRowWithManifest(certificateId)

    if (!result) {
      return { valid: false, failure: 'cert_not_found' }
    }

    const { cert, manifest } = result

    // Chain check
    const chainResult = await this.verifyDocumentChain(cert.documentId)
    if (!chainResult.ok) {
      return { valid: false, failure: 'chain_broken', details: chainResult.brokenAt }
    }

    // Log check: pick the first log entry on or after the completion date,
    // then recompute the day's Merkle root from the same set of audit_logs
    // that `appendDailyLogEntry` used (i.e. all audit_logs whose created_at
    // falls in [dayStart, dayEnd) for that log entry's log_date). If the
    // recomputed root doesn't match the stored merkle_root, the log has
    // been tampered with or rewritten (the property the D.3 spec promised
    // the transparency log would provide).
    const completionDate = (manifest.completedAt || cert.createdAt.toISOString()).slice(0, 10)
    const { data: logEntry } = await supabase
      .from('evidence_log_entries')
      .select('log_date, merkle_root, entry_count')
      .gte('log_date', completionDate)
      .order('log_date', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!logEntry) {
      return { valid: false, failure: 'log_missing', details: `No log entry for ${completionDate}` }
    }

    const dayStr = logEntry.log_date as string
    const dayStart = new Date(dayStr + 'T00:00:00Z')
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    const { data: dayRows, error: dayErr } = await supabase
      .from('audit_logs')
      .select('hash')
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString())

    if (dayErr) {
      logger.error('evidence.verify.audit_day_fetch_failed', dayErr, { dayStr })
      return { valid: false, failure: 'log_broken', details: 'Failed to fetch daily audit logs for verification' }
    }

    const dayLeaves = (dayRows ?? [])
      .map(r => toBuffer(r.hash))
      .filter((b): b is Buffer => b !== null && b.length === 32)

    const recomputedRoot = merkleRoot(dayLeaves)
    // merkle_root is NOT NULL in the DB schema; toBuffer() will not return
    // null in practice. The `?? Buffer.alloc(0)` keeps TypeScript happy
    // and produces the same mismatch outcome as a null row would.
    const storedRoot = toBuffer(logEntry.merkle_root) ?? Buffer.alloc(0)

    // The recomputed root must equal the stored merkle_root. If not, the
    // log entry's merkle_root does not match the audit_logs the appender
    // actually saw that day -- the log was tampered with.
    if (recomputedRoot.length !== storedRoot.length || !recomputedRoot.equals(storedRoot)) {
      return {
        valid: false,
        failure: 'log_broken',
        details: `Log entry merkle_root mismatch for ${dayStr}: recomputed ${recomputedRoot.toString('hex')} vs stored ${storedRoot.toString('hex')}`,
      }
    }

    // Sanity: entry_count should match the leaf count we got. Not the
    // primary check (the merkle_root comparison above is), but a cheap
    // signal if the table was touched but the root happens to match.
    if (typeof logEntry.entry_count === 'number' && logEntry.entry_count !== dayLeaves.length) {
      return {
        valid: false,
        failure: 'log_broken',
        details: `Log entry entry_count mismatch for ${dayStr}: ${logEntry.entry_count} vs ${dayLeaves.length}`,
      }
    }

    // TSA check -- if token exists, TSA is verified
    const tsaOk = cert.tstToken !== null

    if (tsaOk) {
      return { valid: true, chainOk: true, logOk: true, tsaOk: true, manifest }
    }
    return { valid: true, chainOk: true, logOk: true, tsaOk: false, tsaTokenMissing: true, manifest }
  },

  /**
   * Issue a legal evidence certificate for a completed document.
   *
   * Phase A (synchronous, before HTTP response):
   * 1. Fetch the completed document (title, content, status check)
   * 2. Verify the audit chain via verifyDocumentChain
   * 3. Compute content hashes via hashContent
   * 4. Fetch signers and audit rows
   * 5. Compute chain root hash and merkle root
   * 6. Build the JSON manifest
   * 7. INSERT a certificates row
   * 8. Render the PDF
   * 9. Upload to Vercel Blob
   * 10. UPDATE the cert row with pdf_storage_path
   * 11. Fire-and-forget Phase B (TSA timestamp) if !options.skipTsa
   *
   * Phase B (fire-and-forget): requestAndStoreTimestamp
   */
  async issueCertificate(
    documentId: string,
    options: { skipTsa?: boolean } = {},
  ): Promise<Certificate> {
    const supabase = createAdminClient()

    // Fetch the completed document
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, title, user_id, content, status, completed_at, content_hash_at_send')
      .eq('id', documentId)
      .single()

    if (docErr || !doc) {
      logger.error('evidence.issue.doc_fetch_failed', docErr, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to load document for cert')
    }

    if (doc.status !== 'completed') {
      throw new ServiceError('CONFLICT', 'Document is not completed')
    }

    // Verify the chain before issuing
    const chainResult = await this.verifyDocumentChain(documentId)
    if (!chainResult.ok) {
      logger.error('evidence.issue.chain_broken', null, {
        documentId, brokenAt: chainResult.brokenAt,
      })
      throw new ServiceError('INTEGRITY_FAILURE', 'Audit chain is broken; cannot issue certificate')
    }

    // Use the content_hash_at_send recorded at send time. If the row is null,
    // the document was sent before evidence tracking was enabled (or before
    // the F1 fix landed). Silently recomputing from current content would
    // perpetuate the bug -- the two hashes would always be equal and the
    // post-send tamper detection would be a no-op. Reject so the operator
    // can decide what to do (re-send, archive, etc.).
    const storedHashAtSend = doc.content_hash_at_send
    if (storedHashAtSend === null || storedHashAtSend === undefined) {
      logger.error('evidence.issue.content_hash_at_send_missing', null, { documentId })
      throw new ServiceError(
        'INTEGRITY_FAILURE',
        'Document was sent before evidence tracking was enabled; cannot certify',
      )
    }
    const contentHashAtSend = toBuffer(storedHashAtSend)!

    // Compute content hash at completion from the current content
    const contentHashAtCompletion = this.hashContent(doc.content)

    // Fetch signers
    const { data: signers } = await supabase
      .from('signers')
      .select('id, email, name, signed_at')
      .eq('document_id', documentId)

    // Fetch the audit chain
    const { data: auditRows } = await supabase
      .from('audit_logs')
      .select('id, action, actor_email, created_at, hash')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true })

    const chainHashes = (auditRows ?? [])
      .map(r => toBuffer(r.hash))
      .filter((b): b is Buffer => b !== null)
    const merkleRootForDoc = merkleRoot(chainHashes)
    const chainRootHash = chainHashes[chainHashes.length - 1] ?? Buffer.alloc(0)

    // Build manifest
    const manifest: JsonManifest = {
      documentId: doc.id,
      documentTitle: doc.title,
      completedAt: doc.completed_at,
      signers: (signers ?? []).map(s => ({
        name: s.name, email: s.email, signedAt: s.signed_at,
      })),
      auditChain: (auditRows ?? []).map(r => ({
        action: r.action,
        actorEmail: r.actor_email,
        createdAt: r.created_at,
        hash: r.hash instanceof Buffer ? r.hash.toString('hex') : String(r.hash || ''),
      })),
      contentHashAtSend: contentHashAtSend.toString('hex'),
      contentHashAtCompletion: contentHashAtCompletion.toString('hex'),
    }

    // Phase A.1: insert the cert row
    const { data: certRow, error: insertErr } = await supabase
      .from('certificates')
      .insert({
        document_id: doc.id,
        content_hash_at_send: contentHashAtSend,
        content_hash_at_completion: contentHashAtCompletion,
        chain_root_hash: chainRootHash,
        merkle_root_at_completion: merkleRootForDoc,
        json_manifest: manifest,
      })
      .select('id, created_at')
      .single()

    if (insertErr || !certRow) {
      logger.error('evidence.issue.cert_insert_failed', insertErr, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to insert certificate')
    }

    // Phase A.2: render the PDF
    const createdAt = new Date(certRow.created_at)
    const certForPdf: Certificate = {
      id: certRow.id,
      documentId: doc.id,
      contentHashAtSend,
      contentHashAtCompletion,
      chainRootHash,
      merkleRootAtCompletion: merkleRootForDoc,
      pdfStoragePath: null,
      tstToken: null,
      createdAt,
      tsaIssuedAt: null,
    }
    const pdfBytes = await renderCertificatePdf(certForPdf, manifest)

    // Phase A.3: upload to Vercel Blob
    let pdfPath: string
    try {
      const blob = await blobPut(`certificates/${certRow.id}.pdf`, pdfBytes, {
        access: 'public',
        contentType: 'application/pdf',
      })
      pdfPath = `certificates/${certRow.id}.pdf`
      logger.info('evidence.issue.pdf_uploaded', { certificateId: certRow.id, url: blob.url })
    } catch (err) {
      logger.error('evidence.issue.blob_upload_failed', err, { certificateId: certRow.id })
      throw new ServiceError('BLOB_UPLOAD_FAILED', 'Failed to upload certificate PDF')
    }

    // Phase A.4: update the cert row with the PDF path
    await supabase
      .from('certificates')
      .update({ pdf_storage_path: pdfPath })
      .eq('id', certRow.id)

    // Phase B: TSA (fire-and-forget if !skipTsa)
    if (!options.skipTsa) {
      this.requestAndStoreTimestamp(certRow.id, contentHashAtCompletion).catch(err => {
        logger.error('evidence.issue.tsa_failed', err, { certificateId: certRow.id, documentId: doc.id })
      })
    }

    return {
      ...certForPdf,
      pdfStoragePath: pdfPath,
    }
  },

  /**
   * Phase B: Request an RFC 3161 timestamp from the TSA and store the
   * token in the certificate row.
   *
   * Fire-and-forget from issueCertificate. Also callable independently
   * by the hourly backfill cron (Task 17).
   */
  async requestAndStoreTimestamp(certificateId: string, documentHash: Buffer): Promise<void> {
    const { requestTimestamp, DEFAULT_TSA_URL } = await import('@/lib/tsa/freetsa')
    const token = await requestTimestamp({
      documentHash,
      tsaUrl: process.env.TSA_URL || DEFAULT_TSA_URL,
    })
    const supabase = createAdminClient()
    await supabase
      .from('certificates')
      .update({ tst_token: token, tsa_issued_at: new Date().toISOString() })
      .eq('id', certificateId)
  },

  /**
   * Append a daily Merkle root entry to the self-hosted transparency log.
   * Idempotent: if an entry already exists for `date`, returns it instead of inserting.
   */
  async appendDailyLogEntry(date: Date): Promise<void> {
    const supabase = createAdminClient()
    const dateStr = date.toISOString().slice(0, 10)
    const dayStart = new Date(dateStr + 'T00:00:00Z')
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    // Check if entry already exists (idempotency)
    const { data: existing } = await supabase
      .from('evidence_log_entries')
      .select('id')
      .eq('log_date', dateStr)
      .maybeSingle()

    if (existing) {
      logger.info('evidence.daily_log.skip_exists', { logDate: dateStr })
      return
    }

    // Fetch all audit entries for the day
    const { data: rows, error: rowsErr } = await supabase
      .from('audit_logs')
      .select('hash')
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString())

    if (rowsErr) {
      logger.error('evidence.daily_log.audit_fetch_failed', rowsErr, { logDate: dateStr })
      throw new ServiceError('INTERNAL', 'Failed to fetch audit entries for daily log')
    }

    const leaves = (rows ?? [])
      .map(r => toBuffer(r.hash))
      .filter((b): b is Buffer => b !== null && b.length === 32)

    const merkleRootForDay = merkleRoot(leaves)

    // Fetch previous log entry -- must be the most recent entry on or before
    // `dateStr`, not the most recent entry globally. Without the .lte filter,
    // a backfill call for a past date (e.g. after an outage) would chain off a
    // future entry's log_hash, breaking the chain's monotonicity.
    const { data: prevEntry } = await supabase
      .from('evidence_log_entries')
      .select('log_hash')
      .lte('log_date', dateStr)
      .order('log_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    const prevLogHash = prevEntry ? toBuffer(prevEntry.log_hash) : null

    // Compute log_hash = SHA-256(prev_log_hash || merkle_root || entry_count || log_date)
    const logHash = createHash('sha256')
    if (prevLogHash) logHash.update(prevLogHash)
    logHash.update(merkleRootForDay)
    const entryCountBuf = Buffer.alloc(4)
    entryCountBuf.writeUInt32BE(leaves.length)
    logHash.update(entryCountBuf)
    logHash.update(dateStr, 'utf8')
    const finalLogHash = logHash.digest()

    const { error: insertErr } = await supabase
      .from('evidence_log_entries')
      .insert({
        log_date: dateStr,
        merkle_root: merkleRootForDay,
        entry_count: leaves.length,
        prev_log_hash: prevLogHash,
        log_hash: finalLogHash,
      })

    if (insertErr) {
      logger.error('evidence.daily_log.insert_failed', insertErr, { logDate: dateStr })
      throw new ServiceError('INTERNAL', 'Failed to insert daily log entry')
    }

    logger.info('evidence.daily_log.appended', {
      logDate: dateStr, entryCount: leaves.length,
    })
  },
}

function mapCertificate(row: Record<string, unknown>): Certificate {
  // The supabase admin client has no custom transformer, so PostgREST
  // returns BYTEA columns as hex strings (or as Buffer in some setups).
  // Normalize all 5 BYTEA fields to Buffer using the shared `toBuffer`
  // helper. The required BYTEA fields (content_hash_at_send, etc.) are
  // NOT NULL in the DB schema; the optional ones (merkle_root_at_completion,
  // tst_token) round-trip through `toBuffer` which preserves nullness.
  const bytea = (v: unknown) => toBuffer(v as Buffer | string | null | undefined)
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    contentHashAtSend: bytea(row.content_hash_at_send) ?? Buffer.alloc(0),
    contentHashAtCompletion: bytea(row.content_hash_at_completion) ?? Buffer.alloc(0),
    chainRootHash: bytea(row.chain_root_hash) ?? Buffer.alloc(0),
    merkleRootAtCompletion: bytea(row.merkle_root_at_completion),
    pdfStoragePath: (row.pdf_storage_path as string) ?? null,
    tstToken: bytea(row.tst_token),
    createdAt: new Date(row.created_at as string),
    tsaIssuedAt: row.tsa_issued_at ? new Date(row.tsa_issued_at as string) : null,
  }
}
