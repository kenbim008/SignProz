import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase admin client before importing the service
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}))

// Mock the email module so dynamic import('@/lib/email/sendMagicLink') in
// sendForSigning doesn't try to instantiate nodemailer/Resend during tests.
const mockSendMagicLinkEmail = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/email/sendMagicLink', () => ({
  sendMagicLinkEmail: (...args: unknown[]) => mockSendMagicLinkEmail(...args),
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
      then: (
        resolve: (v: { data: unknown; count: number | null; error: unknown }) => void
      ) => resolve({ data: fakeDocs, count: fakeCount, error: null }),
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

describe('DocumentService.create', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('inserts a document, signers, and fields', async () => {
    // Mock the document insert
    const insertDocMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'new-doc' }, error: null }),
    })
    // Mock the signers insert (must support .select for id mapping)
    const insertSignersMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: 's1', order: 0 }], error: null }),
    })
    // Mock the fields insert
    const insertFieldsMock = vi.fn().mockResolvedValue({ error: null })
    // Mock the audit log insert
    const insertAuditMock = vi.fn().mockResolvedValue({ error: null })
    // Mock final this.get() call
    const getChainMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'new-doc', title: 'New Doc' },
        error: null,
      }),
    }

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return { insert: insertDocMock } // document insert
      if (callCount === 2) return { insert: insertSignersMock } // signers insert
      if (callCount === 3) return { insert: insertFieldsMock } // fields insert
      if (callCount === 4) return { insert: insertAuditMock } // audit log
      return getChainMock // final this.get()
    })

    const result = await DocumentService.create('user-1', {
      title: 'New Doc',
      content: 'Body',
      signers: [{ email: 's@x.com', name: 'S' }],
      fields: [{ field_type: 'signature', position_x: 10, position_y: 20, signer_index: 0 }],
    })

    expect(result.id).toBe('new-doc')
  })
})

describe('DocumentService.sendForSigning', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockSendMagicLinkEmail.mockClear()
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

  it('writes a non-null 32-byte content_hash_at_send atomically with the status transition', async () => {
    // F1 fix: when transitioning draft -> sent, the documents UPDATE payload
    // must include content_hash_at_send as a 32-byte Buffer so the integrity
    // model can later detect post-send content edits.
    const documentContent = '<p>contract body</p>'
    let docUpdatePayload: Record<string, unknown> | null = null

    // Build a queue of mock responses for each supabase.from() call in
    // sendForSigning. Order:
    //   1. validateOwnership (documents, id/user_id/status/content) -- M2 fold
    //   2. signers.select
    //   3. signature_fields.select
    //   4. signers.update (per signer)
    //   5. documents.update (the one we want to capture)
    //   6. audit_logs.insert
    //   7. this.get() final fetch
    let callIndex = 0
    mockFrom.mockImplementation((table: string) => {
      callIndex++
      // 1: validateOwnership - documents select id/user_id/status/content
      if (callIndex === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'd1', user_id: 'user-1', status: 'draft', content: documentContent, expiration_days: 7 },
            error: null,
          }),
        }
      }
      // 2: signers.select
      if (callIndex === 2) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 's1', email: 'a@x.com', name: 'Alice', order: 0 }],
            error: null,
          }),
        }
      }
      // 3: signature_fields.select
      if (callIndex === 3) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'f1', signer_id: 's1' }],
            error: null,
          }),
        }
      }
      // 4: signers.update (one per signer; we have 1)
      if (callIndex === 4) {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      // 5: documents.update -- capture the payload
      if (callIndex === 5) {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            docUpdatePayload = payload
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }
          }),
        }
      }
      // 6: audit_logs.insert
      if (callIndex === 6) {
        return {
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      // 7: this.get() final fetch
      if (callIndex === 7) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'd1',
              user_id: 'user-1',
              status: 'sent',
              content: documentContent,
            },
            error: null,
          }),
        }
      }
      throw new Error(`unexpected mockFrom call #${callIndex} for table ${table}`)
    })

    await DocumentService.sendForSigning('d1', 'user-1')

    // The UPDATE payload must have been captured and contain the new field.
    expect(docUpdatePayload).toBeTruthy()
    expect(docUpdatePayload).toMatchObject({ status: 'sent' })
    expect(docUpdatePayload).toHaveProperty('content_hash_at_send')
    const payload: Record<string, unknown> = docUpdatePayload!
    const hash = payload.content_hash_at_send
    expect(Buffer.isBuffer(hash)).toBe(true)
    expect((hash as Buffer).length).toBe(32)
  })

  it('M2: performs only TWO documents SELECTs during sendForSigning (folds content fetch into ownership check)', async () => {
    // The pre-M2 implementation did three SELECTs against the documents
    // table: validateOwnership (id/user_id/status), a dedicated content
    // fetch, and the final this.get() in sendForSigning. The content
    // fetch has been folded into validateOwnership (id/user_id/status/content),
    // so the total drops to two. The update() call is a write, not a
    // read, and does not count.
    const documentContent = '<p>contract body</p>'
    let documentsSelectCallCount = 0
    let documentsUpdateCallCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'documents') {
        return {
          select: vi.fn(() => {
            documentsSelectCallCount++
            return {
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'd1',
                  user_id: 'user-1',
                  status: 'draft',
                  content: documentContent,
                  expiration_days: 7,
                },
                error: null,
              }),
            }
          }),
          update: vi.fn((_payload: Record<string, unknown>) => {
            documentsUpdateCallCount++
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }
          }),
        }
      }
      if (table === 'signers') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 's1', email: 'a@x.com', name: 'Alice', order: 0 }],
            error: null,
          }),
          update: vi.fn((_payload: Record<string, unknown>) => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        }
      }
      if (table === 'signature_fields') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'f1', signer_id: 's1' }],
            error: null,
          }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      throw new Error(`unexpected table ${table}`)
    })

    await DocumentService.sendForSigning('d1', 'user-1')

    // M2 fold: validateOwnership (1) + this.get() (1) = 2 reads.
    // Pre-M2: 3 (validateOwnership + content fetch + this.get()).
    expect(documentsSelectCallCount).toBe(2)
    expect(documentsUpdateCallCount).toBe(1)
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
