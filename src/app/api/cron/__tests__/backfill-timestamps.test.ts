import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const mockRequestAndStoreTimestamp = vi.fn()
const mockLimit = vi.fn()
const mockIs = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/services', () => ({
  EvidenceService: {
    requestAndStoreTimestamp: (...args: unknown[]) => mockRequestAndStoreTimestamp(...args),
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

const POST = (await import('@/app/api/cron/backfill-timestamps/route')).POST

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret-12345'
})

beforeEach(() => {
  mockRequestAndStoreTimestamp.mockReset()
  mockRequestAndStoreTimestamp.mockResolvedValue(undefined)
  mockFrom.mockReset()
  mockSelect.mockReset()
  mockIs.mockReset()
  mockLimit.mockReset()

  mockSelect.mockReturnValue({ is: mockIs })
  mockIs.mockReturnValue({ limit: mockLimit })
  mockFrom.mockReturnValue({ select: mockSelect })
})

function makeRequest(authHeader: string | null): Request {
  const headers = new Headers()
  if (authHeader !== null) headers.set('authorization', authHeader)
  return new Request('http://localhost/api/cron/backfill-timestamps', { method: 'POST', headers })
}

const HASH_HEX = 'a'.repeat(64)

describe('POST /api/cron/backfill-timestamps', () => {
  it('returns 401 when authorization header is missing', async () => {
    const res = await POST(makeRequest(null))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRequestAndStoreTimestamp).not.toHaveBeenCalled()
  })

  it('returns 401 when authorization header has the wrong value', async () => {
    const res = await POST(makeRequest('Bearer wrong-secret-12345'))
    expect(res.status).toBe(401)
    expect(mockRequestAndStoreTimestamp).not.toHaveBeenCalled()
  })

  it('returns 200 with zero counters when no pending certificates exist', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null })
    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, succeeded: 0, failed: 0 })
    expect(mockRequestAndStoreTimestamp).not.toHaveBeenCalled()
  })

  it('returns 200 with zero counters when pending is null', async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: null })
    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, succeeded: 0, failed: 0 })
  })

  it('converts hex strings to Buffers and calls requestAndStoreTimestamp for each pending cert', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        { id: 'cert-1', content_hash_at_completion: HASH_HEX },
        { id: 'cert-2', content_hash_at_completion: HASH_HEX },
      ],
      error: null,
    })
    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, succeeded: 2, failed: 0 })
    expect(mockRequestAndStoreTimestamp).toHaveBeenCalledTimes(2)
    expect(mockRequestAndStoreTimestamp).toHaveBeenNthCalledWith(1, 'cert-1', expect.any(Buffer))
    expect(mockRequestAndStoreTimestamp).toHaveBeenNthCalledWith(2, 'cert-2', expect.any(Buffer))
    const firstArg = mockRequestAndStoreTimestamp.mock.calls[0][1] as Buffer
    expect(firstArg.length).toBe(32)
  })

  it('passes Buffer hashes through unchanged when already a Buffer', async () => {
    const bufferHash = Buffer.alloc(32, 7)
    mockLimit.mockResolvedValueOnce({
      data: [{ id: 'cert-1', content_hash_at_completion: bufferHash }],
      error: null,
    })
    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(mockRequestAndStoreTimestamp).toHaveBeenCalledWith('cert-1', bufferHash)
  })

  it('counts failures and continues the loop when requestAndStoreTimestamp throws', async () => {
    mockRequestAndStoreTimestamp
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('tsa down'))
      .mockResolvedValueOnce(undefined)
    mockLimit.mockResolvedValueOnce({
      data: [
        { id: 'cert-1', content_hash_at_completion: HASH_HEX },
        { id: 'cert-2', content_hash_at_completion: HASH_HEX },
        { id: 'cert-3', content_hash_at_completion: HASH_HEX },
      ],
      error: null,
    })
    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, succeeded: 2, failed: 1 })
    expect(mockRequestAndStoreTimestamp).toHaveBeenCalledTimes(3)
  })
})
