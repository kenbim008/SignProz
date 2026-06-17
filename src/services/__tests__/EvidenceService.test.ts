import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockSupabase = { from: mockFrom, rpc: mockRpc }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}))

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
