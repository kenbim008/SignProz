import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase admin client before importing the service
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
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
