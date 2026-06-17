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
