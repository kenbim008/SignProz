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
    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (table === 'certificates') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'cert-1',
              document_id: 'doc-1',
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
          maybeSingle: vi.fn().mockResolvedValue({ data: { log_hash: Buffer.alloc(32, 9) }, error: null }),
        }
      }
      throw new Error(`unexpected ${table} at #${callCount}`)
    })

    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })

    const r = await EvidenceService.verifyCertificate('cert-1')
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.chainOk).toBe(true)
      expect(r.logOk).toBe(true)
      expect(r.tsaOk).toBe(true)
    }
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
        // callCount 3: prev entry fetch (order/limit/single)
        if (callCount === 3) {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
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
})
