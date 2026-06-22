import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockSupabase = { from: mockFrom, rpc: mockRpc }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}))

const mockBlobPut = vi.fn()
vi.mock('@vercel/blob', () => ({ put: (...args: unknown[]) => mockBlobPut(...args) }))

import { EvidenceService } from '@/services/EvidenceService'
import { createHash } from 'node:crypto'

beforeEach(() => {
  mockFrom.mockReset()
  mockRpc.mockReset()
})

describe('EvidenceService.hashContent', () => {
  it('produces a 32-byte SHA-256', () => {
    const h = EvidenceService.hashContent('hello')
    expect(h.length).toBe(32)
    const expected = createHash('sha256').update('hello').digest()
    expect(h.equals(expected)).toBe(true)
  })

  it('canonicalizes before hashing (whitespace differences produce same hash)', () => {
    const a = EvidenceService.hashContent('hello\r\nworld')
    const b = EvidenceService.hashContent('hello\nworld')
    expect(a.equals(b)).toBe(true)
  })

  it('handles null and undefined', () => {
    const hNull = EvidenceService.hashContent(null)
    const hUndef = EvidenceService.hashContent(undefined)
    const hEmpty = EvidenceService.hashContent('')
    expect(hNull.length).toBe(32)
    expect(hNull.equals(hUndef)).toBe(true)
    expect(hNull.equals(hEmpty)).toBe(true)
  })
})

describe('EvidenceService.verifyDocumentChain', () => {
  it('returns ok when RPC returns ok=true', async () => {
    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })
    const r = await EvidenceService.verifyDocumentChain('doc-1')
    expect(r).toEqual({ ok: true })
  })

  it('returns broken details when RPC returns ok=false', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        ok: false,
        broken_at: 'row-1',
        expected_hash: 'aabb',
        actual_hash: 'ccdd',
      }],
      error: null,
    })
    const r = await EvidenceService.verifyDocumentChain('doc-1')
    expect(r).toEqual({
      ok: false,
      brokenAt: 'row-1',
      expected: 'aabb',
      actual: 'ccdd',
    })
  })

  it('returns ok when data is empty (no chain rows)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    const r = await EvidenceService.verifyDocumentChain('doc-1')
    expect(r).toEqual({ ok: true })
  })

  it('throws ServiceError on RPC failure', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    await expect(EvidenceService.verifyDocumentChain('doc-1')).rejects.toMatchObject({ code: 'INTERNAL' })
  })
})

describe('EvidenceService.getCertificate', () => {
  it('returns null when no certificate exists', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    })
    const r = await EvidenceService.getCertificate('doc-1')
    expect(r).toBeNull()
  })

  it('returns a mapped certificate when found', async () => {
    const fakeRow = {
      id: 'cert-1',
      document_id: 'doc-1',
      content_hash_at_send: Buffer.from('a'.repeat(64), 'hex'),
      content_hash_at_completion: Buffer.from('b'.repeat(64), 'hex'),
      chain_root_hash: Buffer.from('c'.repeat(64), 'hex'),
      merkle_root_at_completion: null,
      pdf_storage_path: '/certs/cert-1.pdf',
      tst_token: null,
      created_at: '2026-06-16T00:00:00.000Z',
      tsa_issued_at: null,
    }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
    })
    const r = await EvidenceService.getCertificate('doc-1')
    expect(r).not.toBeNull()
    expect(r!.id).toBe('cert-1')
    expect(r!.documentId).toBe('doc-1')
    expect(r!.createdAt).toBeInstanceOf(Date)
    expect(r!.tsaIssuedAt).toBeNull()
  })

  it('F3.2: normalizes BYTEA columns returned as hex strings to Buffer instances', async () => {
    // The supabase admin client has no custom transformer, so PostgREST may
    // return BYTEA columns as hex strings instead of Buffer. mapCertificate
    // must coerce them back to Buffer so the PDF renderer's .toString('hex')
    // call produces the correct hash. This test pins the fix: the mapped
    // Certificate's BYTEA fields are real Buffer instances, and the bytes
    // match the hex string that came in.
    const hex = 'aa'.repeat(32) // 64 hex chars = 32 bytes
    const fakeRow = {
      id: 'cert-1',
      document_id: 'doc-1',
      content_hash_at_send: hex,
      content_hash_at_completion: 'bb'.repeat(32),
      chain_root_hash: 'cc'.repeat(32),
      merkle_root_at_completion: 'dd'.repeat(32),
      pdf_storage_path: '/certs/cert-1.pdf',
      tst_token: 'ee'.repeat(16),
      created_at: '2026-06-16T00:00:00.000Z',
      tsa_issued_at: null,
    }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
    })
    const r = await EvidenceService.getCertificate('doc-1')
    expect(r).not.toBeNull()
    expect(Buffer.isBuffer(r!.contentHashAtSend)).toBe(true)
    expect(Buffer.isBuffer(r!.contentHashAtCompletion)).toBe(true)
    expect(Buffer.isBuffer(r!.chainRootHash)).toBe(true)
    expect(Buffer.isBuffer(r!.merkleRootAtCompletion)).toBe(true)
    expect(Buffer.isBuffer(r!.tstToken)).toBe(true)
    expect(r!.contentHashAtSend.toString('hex')).toBe(hex)
    expect(r!.contentHashAtCompletion.toString('hex')).toBe('bb'.repeat(32))
    expect(r!.chainRootHash.toString('hex')).toBe('cc'.repeat(32))
    expect(r!.merkleRootAtCompletion!.toString('hex')).toBe('dd'.repeat(32))
    expect(r!.tstToken!.toString('hex')).toBe('ee'.repeat(16))
  })
})

describe('EvidenceService.getCertificateById', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('returns null when no certificate exists for the given id', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    })
    const r = await EvidenceService.getCertificateById('missing-cert')
    expect(r).toBeNull()
  })

  it('M5: looks up by primary key (id), not by document_id', async () => {
    // The verify page has the cert id (from the URL) but not the document
    // id. getCertificateById must filter on `id`, while getCertificate
    // filters on `document_id`. We assert the column used in the .eq()
    // call is `id` (not `document_id`).
    let capturedEqCol: string | null = null
    let capturedEqVal: string | null = null
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((col: string, val: unknown) => {
        capturedEqCol = col
        capturedEqVal = val as string
        return {
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
    })
    await EvidenceService.getCertificateById('cert-1')
    expect(capturedEqCol).toBe('id')
    expect(capturedEqVal).toBe('cert-1')
  })

  it('returns a mapped Certificate when found', async () => {
    const fakeRow = {
      id: 'cert-1',
      document_id: 'doc-1',
      content_hash_at_send: Buffer.from('a'.repeat(64), 'hex'),
      content_hash_at_completion: Buffer.from('b'.repeat(64), 'hex'),
      chain_root_hash: Buffer.from('c'.repeat(64), 'hex'),
      merkle_root_at_completion: null,
      pdf_storage_path: null,
      tst_token: null,
      created_at: '2026-06-16T00:00:00.000Z',
      tsa_issued_at: null,
    }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
    })
    const r = await EvidenceService.getCertificateById('cert-1')
    expect(r).not.toBeNull()
    expect(r!.id).toBe('cert-1')
    expect(r!.documentId).toBe('doc-1')
  })
})

describe('EvidenceService.issueCertificate (Phase A)', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
    mockBlobPut.mockReset()
  })

  it('inserts a cert row, generates a PDF, uploads to Blob, updates the row', async () => {
    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (table === 'documents') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'doc-1',
              title: 'Test',
              user_id: 'u-1',
              content: '<p>hello</p>',
              status: 'completed',
              completed_at: '2026-06-16T12:00:00Z',
              // F1: content_hash_at_send must now be present in the documents
              // row. Equal to hashContent('<p>hello</p>') so the existing
              // happy-path test continues to pass.
              content_hash_at_send: EvidenceService.hashContent('<p>hello</p>'),
            },
            error: null,
          }),
        }
      }
      if (table === 'signers') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 's-1', email: 'a@x.com', name: 'Alice', signed_at: '2026-06-16T11:55:00Z' }],
            error: null,
          }),
        }
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'r1', action: 'document_created', actor_email: 'owner@x.com', metadata: {}, created_at: '2026-06-16T10:00:00Z', hash: Buffer.alloc(32, 1) },
              { id: 'r2', action: 'document_completed', actor_email: 'owner@x.com', metadata: {}, created_at: '2026-06-16T12:00:00Z', hash: Buffer.alloc(32, 2) },
            ],
            error: null,
          }),
        }
      }
      if (table === 'certificates') {
        if (callCount === 4) {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'cert-1', created_at: '2026-06-16T12:00:00Z' },
              error: null,
            }),
          }
        }
        if (callCount === 5) {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
      }
      throw new Error(`unexpected table ${table} call #${callCount}`)
    })

    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })
    // Mock the blob upload
    mockBlobPut.mockResolvedValue({ url: 'https://blob.vercel-test.dev/cert-1.pdf' })

    const cert = await EvidenceService.issueCertificate('doc-1', { skipTsa: true })

    expect(cert.id).toBe('cert-1')
    expect(cert.pdfStoragePath).toBeTruthy()
    expect(mockBlobPut).toHaveBeenCalledTimes(1)
  })

  it('uses the stored content_hash_at_send from the documents row, not a recompute', async () => {
    // The documents row records a content_hash_at_send that is *deliberately
    // different* from what hashContent(doc.content) would produce. This
    // simulates a post-send content edit: the hash at send time is locked
    // in, the current content is different, and the cert's two hashes must
    // be different -- that is the integrity claim. If the implementation
    // silently recomputed from current content, both hashes would match and
    // tamper detection would be a no-op.
    const originalContent = '<p>hello</p>'
    const editedContent = '<p>hello (tampered)</p>'
    const hashAtSend = EvidenceService.hashContent(originalContent) // what was recorded at send time
    const hashAtCompletion = EvidenceService.hashContent(editedContent) // what current content hashes to

    expect(hashAtSend.equals(hashAtCompletion)).toBe(false) // sanity: they must differ for this test to be meaningful

    let callCount = 0
    const capturedInserts: Array<Record<string, unknown>> = []
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (table === 'documents') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'doc-1',
              title: 'Test',
              user_id: 'u-1',
              content: editedContent, // current content differs from send-time
              status: 'completed',
              completed_at: '2026-06-16T12:00:00Z',
              content_hash_at_send: hashAtSend, // recorded at send time
            },
            error: null,
          }),
        }
      }
      if (table === 'signers') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 's-1', email: 'a@x.com', name: 'Alice', signed_at: '2026-06-16T11:55:00Z' }],
            error: null,
          }),
        }
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'r1', action: 'document_created', actor_email: 'o@x.com', metadata: {}, created_at: '2026-06-16T10:00:00Z', hash: Buffer.alloc(32, 1) },
              { id: 'r2', action: 'document_completed', actor_email: 'o@x.com', metadata: {}, created_at: '2026-06-16T12:00:00Z', hash: Buffer.alloc(32, 2) },
            ],
            error: null,
          }),
        }
      }
      if (table === 'certificates') {
        if (callCount === 4) {
          return {
            insert: vi.fn((payload: Record<string, unknown>) => {
              capturedInserts.push(payload)
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: { id: 'cert-1', created_at: '2026-06-16T12:00:00Z' },
                  error: null,
                }),
              }
            }),
          }
        }
        if (callCount === 5) {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
      }
      throw new Error(`unexpected table ${table} call #${callCount}`)
    })

    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })
    mockBlobPut.mockResolvedValue({ url: 'https://blob.vercel-test.dev/cert-1.pdf' })

    const cert = await EvidenceService.issueCertificate('doc-1', { skipTsa: true })

    // The cert must use the *stored* send-time hash, not a recompute.
    expect(cert.contentHashAtSend.equals(hashAtSend)).toBe(true)
    // The completion hash must be the hash of the *current* content.
    expect(cert.contentHashAtCompletion.equals(hashAtCompletion)).toBe(true)
    // And they must differ -- this is the post-send tamper detection.
    expect(cert.contentHashAtSend.equals(cert.contentHashAtCompletion)).toBe(false)

    // The inserted cert row must also reflect the stored send-time hash.
    expect(capturedInserts).toHaveLength(1)
    const inserted = capturedInserts[0]
    const insertedSendHash = inserted.content_hash_at_send as Buffer
    const insertedCompletionHash = inserted.content_hash_at_completion as Buffer
    expect(insertedSendHash.equals(hashAtSend)).toBe(true)
    expect(insertedCompletionHash.equals(hashAtCompletion)).toBe(true)
    expect(insertedSendHash.equals(insertedCompletionHash)).toBe(false)
  })

  it('rejects with INTEGRITY_FAILURE when documents.content_hash_at_send is null (legacy pre-F1 doc)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'documents') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'doc-1',
              title: 'Test',
              user_id: 'u-1',
              content: '<p>hello</p>',
              status: 'completed',
              completed_at: '2026-06-16T12:00:00Z',
              content_hash_at_send: null, // legacy: sent before evidence tracking
            },
            error: null,
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })

    await expect(EvidenceService.issueCertificate('doc-1', { skipTsa: true }))
      .rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' })
  })
})

describe('EvidenceService.verifyCertificate', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('returns valid: true with all checks passing', async () => {
    // F3.3: the log check now reads the stored leaf set from
    // evidence_log_entries.leaf_hashes and tests cert.merkle_root_at_completion
    // for membership -- no audit_logs fetch, no recompute. The mock here
    // provides a leaf_hashes JSONB array containing the cert's merkle root,
    // and the mockFrom impl throws on audit_logs so any accidental day
    // fetch would fail the test loudly.
    const certLeafHex = 'aa'.repeat(32)
    const certLeaf = Buffer.from(certLeafHex, 'hex')
    mockFrom.mockImplementation((table: string) => {
      if (table === 'certificates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'cert-1',
              document_id: 'doc-1',
              merkle_root_at_completion: certLeaf,
              json_manifest: {
                documentId: 'doc-1', documentTitle: 'Test', completedAt: '2026-06-16T12:00:00Z',
                signers: [], auditChain: [], contentHashAtSend: 'aa', contentHashAtCompletion: 'bb',
              },
              tst_token: Buffer.alloc(10), tsa_issued_at: '2026-06-16T12:05:00Z', created_at: '2026-06-16T12:00:00Z',
            },
            error: null,
          }),
        }
      }
      if (table === 'evidence_log_entries') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              log_date: '2026-06-16',
              merkle_root: certLeaf,
              entry_count: 1,
              leaf_hashes: [certLeafHex],
            },
            error: null,
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })

    const r = await EvidenceService.verifyCertificate('cert-1')
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.chainOk).toBe(true)
      expect(r.logOk).toBe(true)
      expect(r.tsaOk).toBe(true)
    }

    // F3.3 invariant: verify does not touch audit_logs (no recompute).
    const fromCalls = mockFrom.mock.calls.map(c => c[0])
    expect(fromCalls).not.toContain('audit_logs')
  })

  it('returns cert_not_found when the cert does not exist', async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    }))

    const r = await EvidenceService.verifyCertificate('nonexistent')
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.failure).toBe('cert_not_found')
  })

  it('returns chain_broken when the chain fails verification', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'certificates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'cert-1', document_id: 'doc-1',
              json_manifest: { documentId: 'doc-1', documentTitle: 'T', completedAt: '2026-06-16T12:00:00Z', signers: [], auditChain: [], contentHashAtSend: 'aa', contentHashAtCompletion: 'bb' },
              tst_token: null, tsa_issued_at: null, created_at: '2026-06-16T12:00:00Z',
            },
            error: null,
          }),
        }
      }
      if (table === 'evidence_log_entries') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { log_hash: Buffer.alloc(32, 9) }, error: null }),
        }
      }
      return {} as any
    })

    mockRpc.mockResolvedValue({
      data: [{ ok: false, broken_at: 'r1', expected_hash: 'aa', actual_hash: 'bb' }],
      error: null,
    })

    const r = await EvidenceService.verifyCertificate('cert-1')
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.failure).toBe('chain_broken')
  })

  it('F3.3: returns log_missing when no log entry exists for the completion date', async () => {
    // No log entry on/after the completion date -- the daily transparency
    // log has not been written for that day yet. This is the same outcome
    // as the pre-F3.3 implementation; pin it so the new check does not
    // accidentally short-circuit on something else.
    mockFrom.mockImplementation((table: string) => {
      if (table === 'certificates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'cert-1', document_id: 'doc-1',
              json_manifest: { documentId: 'doc-1', documentTitle: 'T', completedAt: '2026-06-16T12:00:00Z', signers: [], auditChain: [], contentHashAtSend: 'aa', contentHashAtCompletion: 'bb' },
              tst_token: null, tsa_issued_at: null, created_at: '2026-06-16T12:00:00Z',
            },
            error: null,
          }),
        }
      }
      if (table === 'evidence_log_entries') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })

    const r = await EvidenceService.verifyCertificate('cert-1')
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.failure).toBe('log_missing')
      expect(r.details).toContain('2026-06-16')
    }
  })

  it('F3.3: returns log_broken when the cert merkle_root is not in the stored leaf set', async () => {
    // The pre-F3.3 check recomputed the day's root from audit_logs and
    // compared it to log_entry.merkle_root. The F3.3 check instead tests
    // cert.merkle_root_at_completion for membership in log_entry.leaf_hashes.
    // Here the log entry's leaf set exists but does NOT contain the cert's
    // merkle root -- a tampering or rewrite signal.
    const certLeaf = Buffer.from('aa'.repeat(32), 'hex')
    const otherLeaf = Buffer.from('bb'.repeat(32), 'hex')

    mockFrom.mockImplementation((table: string) => {
      if (table === 'certificates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'cert-1', document_id: 'doc-1',
              merkle_root_at_completion: certLeaf,
              json_manifest: { documentId: 'doc-1', documentTitle: 'T', completedAt: '2026-06-16T12:00:00Z', signers: [], auditChain: [], contentHashAtSend: 'aa', contentHashAtCompletion: 'bb' },
              tst_token: null, tsa_issued_at: null, created_at: '2026-06-16T12:00:00Z',
            },
            error: null,
          }),
        }
      }
      if (table === 'evidence_log_entries') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              log_date: '2026-06-16',
              merkle_root: otherLeaf,
              entry_count: 1,
              leaf_hashes: [otherLeaf.toString('hex')],
            },
            error: null,
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })

    const r = await EvidenceService.verifyCertificate('cert-1')
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.failure).toBe('log_broken')
      expect(r.details).toContain('not in stored leaf set')
    }
  })

  it('F3.3: returns log_broken when the log entry entry_count does not match the leaf set size', async () => {
    // Defense in depth: the membership test above is the primary check, but
    // a separately-stored entry_count that disagrees with the leaf_hashes
    // array length is still a tampering signal. Mock a leaf set whose
    // membership passes, then lie about entry_count.
    const leaf = Buffer.from('cc'.repeat(32), 'hex')
    mockFrom.mockImplementation((table: string) => {
      if (table === 'certificates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'cert-1', document_id: 'doc-1',
              merkle_root_at_completion: leaf,
              json_manifest: { documentId: 'doc-1', documentTitle: 'T', completedAt: '2026-06-16T12:00:00Z', signers: [], auditChain: [], contentHashAtSend: 'aa', contentHashAtCompletion: 'bb' },
              tst_token: null, tsa_issued_at: null, created_at: '2026-06-16T12:00:00Z',
            },
            error: null,
          }),
        }
      }
      if (table === 'evidence_log_entries') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              log_date: '2026-06-16',
              merkle_root: leaf,
              entry_count: 99,
              leaf_hashes: [leaf.toString('hex')],
            },
            error: null,
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })

    const r = await EvidenceService.verifyCertificate('cert-1')
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.failure).toBe('log_broken')
      expect(r.details).toContain('entry_count mismatch')
    }
  })
})

describe('EvidenceService.appendDailyLogEntry', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('appends a new log entry chained to the previous day', async () => {
    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (table === 'evidence_log_entries') {
        // callCount 1: existing check (maybeSingle)
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        // callCount 3: prev entry fetch (lte/order/limit/maybeSingle)
        if (callCount === 3) {
          return {
            select: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { log_hash: Buffer.alloc(32, 7) },
              error: null,
            }),
          }
        }
        // callCount 4: insert
        if (callCount === 4) {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
      }
      // callCount 2: audit_logs fetch
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lt: vi.fn().mockResolvedValue({
            data: [
              { hash: Buffer.alloc(32, 1) },
              { hash: Buffer.alloc(32, 2) },
            ],
            error: null,
          }),
        }
      }
      throw new Error(`unexpected table ${table} call #${callCount}`)
    })

    await EvidenceService.appendDailyLogEntry(new Date('2026-06-16T12:00:00Z'))
    // Should have made 4 from calls (existing check, audit_logs, prev entry, insert)
    expect(mockFrom).toHaveBeenCalled()
  })

  it('skips when entry already exists', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'evidence_log_entries') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing' }, error: null }),
        }
      }
      throw new Error('should not reach other tables')
    })

    await EvidenceService.appendDailyLogEntry(new Date('2026-06-16T12:00:00Z'))
    // Idempotency: should return without fetching audit_logs
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('F3.5: prev-entry query filters by log_date <= target (backfill safety)', async () => {
    // The previous-day query must be restricted to log_date <= the target
    // date. Otherwise, a backfill call for a past date (e.g. 2026-06-10)
    // would chain off a future entry's log_hash (e.g. 2026-06-15), breaking
    // the chain's monotonicity. We assert the .lte() call is made with the
    // target date and the result is the prev entry on or before that date.
    const targetDate = '2026-06-10'
    const capturedLteFilters: unknown[] = []
    const lteCallDates: unknown[] = []

    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (table === 'evidence_log_entries') {
        if (callCount === 1) {
          // existing check (no entry for 2026-06-10 yet)
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (callCount === 3) {
          // prev entry fetch -- capture the .lte() argument
          const lte = vi.fn((col: string, val: unknown) => {
            capturedLteFilters.push(col)
            lteCallDates.push(val)
            return {
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                // Simulate the DB returning the most recent entry <= 2026-06-10
                data: { log_hash: Buffer.alloc(32, 5) },
                error: null,
              }),
            }
          })
          return {
            select: vi.fn().mockReturnThis(),
            lte,
          }
        }
        if (callCount === 4) {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lt: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      throw new Error(`unexpected table ${table} call #${callCount}`)
    })

    await EvidenceService.appendDailyLogEntry(new Date(`${targetDate}T12:00:00Z`))

    // The prev-entry query must filter by log_date <= targetDate.
    expect(capturedLteFilters).toContain('log_date')
    expect(lteCallDates).toContain(targetDate)
  })

  it('F3.3: insert payload includes leaf_hashes JSONB array of hex strings', async () => {
    // The new O(1) verify path needs the leaf set stored on the log entry.
    // appendDailyLogEntry must write leaf_hashes: [hex, hex, ...] with one
    // entry per day's audit log hash, in the same order they were fetched.
    const leafA = Buffer.alloc(32, 1)
    const leafB = Buffer.alloc(32, 2)
    const capturedInserts: Array<Record<string, unknown>> = []

    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (table === 'evidence_log_entries') {
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (callCount === 3) {
          return {
            select: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { log_hash: Buffer.alloc(32, 7) },
              error: null,
            }),
          }
        }
        if (callCount === 4) {
          return {
            insert: vi.fn((payload: Record<string, unknown>) => {
              capturedInserts.push(payload)
              return { data: null, error: null }
            }),
          }
        }
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lt: vi.fn().mockResolvedValue({
            data: [{ hash: leafA }, { hash: leafB }],
            error: null,
          }),
        }
      }
      throw new Error(`unexpected table ${table} call #${callCount}`)
    })

    await EvidenceService.appendDailyLogEntry(new Date('2026-06-16T12:00:00Z'))

    expect(capturedInserts).toHaveLength(1)
    const payload = capturedInserts[0]
    expect(payload.leaf_hashes).toEqual([leafA.toString('hex'), leafB.toString('hex')])
    expect(payload.entry_count).toBe(2)
  })
})

describe('EvidenceService.retryPhaseA', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
    mockBlobPut.mockReset()
  })

  const baseCertRow = {
    id: 'cert-1',
    document_id: 'doc-1',
    content_hash_at_send: Buffer.from('a'.repeat(64), 'hex'),
    content_hash_at_completion: Buffer.from('b'.repeat(64), 'hex'),
    chain_root_hash: Buffer.from('c'.repeat(64), 'hex'),
    merkle_root_at_completion: Buffer.from('d'.repeat(64), 'hex'),
    pdf_storage_path: null,
    tst_token: null,
    json_manifest: {
      documentId: 'doc-1', documentTitle: 'Test', completedAt: '2026-06-16T12:00:00Z',
      signers: [], auditChain: [], contentHashAtSend: 'aa', contentHashAtCompletion: 'bb',
    },
    created_at: '2026-06-16T12:00:00Z',
    tsa_issued_at: null,
  }

  it('renders, uploads, and updates the cert row when pdf_storage_path is null', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: baseCertRow, error: null }),
      update: vi.fn().mockReturnThis(),
    })
    mockBlobPut.mockResolvedValue({ url: 'https://blob.vercel-test.dev/cert-1.pdf' })

    const r = await EvidenceService.retryPhaseA('cert-1')

    expect(r).toEqual({ skipped: false })
    expect(mockBlobPut).toHaveBeenCalledTimes(1)
    expect(mockBlobPut).toHaveBeenCalledWith(
      'certificates/cert-1.pdf',
      expect.any(Buffer),
      expect.objectContaining({ access: 'public', contentType: 'application/pdf' }),
    )
    // The cert row was updated with pdf_storage_path
    const updateMock = mockFrom.mock.results.find(r => r.value.update)?.value.update as ReturnType<typeof vi.fn>
    expect(updateMock).toBeDefined()
    expect(updateMock).toHaveBeenCalledWith({ pdf_storage_path: 'certificates/cert-1.pdf' })
  })

  it('no-ops when pdf_storage_path is already set (idempotency)', async () => {
    const alreadyDoneRow = { ...baseCertRow, pdf_storage_path: 'certificates/cert-1.pdf' }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: alreadyDoneRow, error: null }),
    })

    const r = await EvidenceService.retryPhaseA('cert-1')

    expect(r).toEqual({ skipped: true })
    expect(mockBlobPut).not.toHaveBeenCalled()
    // No UPDATE call should be issued
    const allMocks = mockFrom.mock.results
    expect(allMocks.find(res => res.value.update)).toBeUndefined()
  })

  it('throws NOT_FOUND when the cert row does not exist', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    })

    await expect(EvidenceService.retryPhaseA('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mockBlobPut).not.toHaveBeenCalled()
  })

  it('propagates blob upload failures as BLOB_UPLOAD_FAILED ServiceError', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: baseCertRow, error: null }),
    })
    mockBlobPut.mockRejectedValue(new Error('blob down'))

    await expect(EvidenceService.retryPhaseA('cert-1')).rejects.toMatchObject({ code: 'BLOB_UPLOAD_FAILED' })
  })
})
