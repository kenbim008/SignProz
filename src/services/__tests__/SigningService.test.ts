import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockSupabase = { from: mockFrom, rpc: mockRpc }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}))

import { SigningService } from '@/services/SigningService'
import { ServiceError } from '@/services/errors'

describe('SigningService.getSigningContext', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('returns the document and fields for a valid token', async () => {
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 's1', document_id: 'd1', email: 's@x.com', name: 'S', signed_at: null, token_expires_at: '2099-01-01' },
            error: null,
          }),
        }
      }
      if (callCount === 2) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'd1', title: 'Test', status: 'sent' },
            error: null,
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [{ id: 'f1', field_type: 'signature' }], error: null }),
      }
    })

    const result = await SigningService.getSigningContext('d1', 'tok-abc')

    expect(result.signer.email).toBe('s@x.com')
    expect(result.document.title).toBe('Test')
  })
})

describe('SigningService.signDocument', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('calls sign_document RPC and returns the result', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, documentStatus: 'partially_signed', signerId: 's1', isSequential: true },
      error: null,
    })
    // After RPC, the service fetches the document and (in sequential mode)
    // the next pending signer. Both queries need to be mocked.
    let signersCallCount = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'signers') {
        signersCallCount++
        if (signersCallCount === 1) {
          // First signers call: lookup next pending signer (returns empty)
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
      }
      // Document fetch
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'd1', title: 'Test', user_id: 'u1', expiration_days: 7 },
          error: null,
        }),
      }
    })

    const result = await SigningService.signDocument('d1', 'tok', [
      { fieldId: 'f1', value: { signature: 'data' } },
    ])

    expect(mockRpc).toHaveBeenCalledWith('sign_document', {
      p_document_id: 'd1',
      p_magic_token: 'tok',
      p_field_values: [{ fieldId: 'f1', value: { signature: 'data' } }],
    })
    expect(result.documentStatus).toBe('partially_signed')
  })

  it('maps PG exception INVALID_TOKEN to UNAUTHORIZED', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'INVALID_TOKEN', code: '28000' },
    })

    await expect(SigningService.signDocument('d1', 'bad', [])).rejects.toThrow(ServiceError)
  })
})
