import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const mockRetryPhaseA = vi.fn()
const mockLimit = vi.fn()
const mockIs = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/services', () => ({
  EvidenceService: {
    retryPhaseA: (...args: unknown[]) => mockRetryPhaseA(...args),
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

const POST = (await import('@/app/api/cron/retry-phase-a/route')).POST

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret-12345'
})

beforeEach(() => {
  mockRetryPhaseA.mockReset()
  mockRetryPhaseA.mockResolvedValue({ skipped: false })
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
  return new Request('http://localhost/api/cron/retry-phase-a', { method: 'POST', headers })
}

describe('POST /api/cron/retry-phase-a', () => {
  it('returns 401 when authorization header is missing', async () => {
    const res = await POST(makeRequest(null))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRetryPhaseA).not.toHaveBeenCalled()
  })

  it('returns 401 when authorization header has the wrong value', async () => {
    const res = await POST(makeRequest('Bearer wrong-secret-12345'))
    expect(res.status).toBe(401)
    expect(mockRetryPhaseA).not.toHaveBeenCalled()
  })

  it('returns 200 with zero counters when no pending certificates exist', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null })
    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, succeeded: 0, failed: 0 })
    expect(mockRetryPhaseA).not.toHaveBeenCalled()
  })

  it('returns 200 with zero counters when pending is null', async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: null })
    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, succeeded: 0, failed: 0 })
  })

  it('queries pdf_storage_path IS NULL and calls retryPhaseA for each pending cert', async () => {
    let isFilterCol: string | null = null
    let isFilterVal: unknown = undefined
    mockIs.mockImplementation((col: string, val: unknown) => {
      isFilterCol = col
      isFilterVal = val
      return { limit: mockLimit }
    })
    mockLimit.mockResolvedValueOnce({
      data: [{ id: 'cert-1' }, { id: 'cert-2' }],
      error: null,
    })

    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, succeeded: 2, failed: 0 })
    expect(isFilterCol).toBe('pdf_storage_path')
    expect(isFilterVal).toBeNull()
    expect(mockRetryPhaseA).toHaveBeenCalledTimes(2)
    expect(mockRetryPhaseA).toHaveBeenNthCalledWith(1, 'cert-1')
    expect(mockRetryPhaseA).toHaveBeenNthCalledWith(2, 'cert-2')
  })

  it('counts failures and continues the loop when retryPhaseA throws', async () => {
    mockRetryPhaseA
      .mockResolvedValueOnce({ skipped: false })
      .mockRejectedValueOnce(new Error('blob down'))
      .mockResolvedValueOnce({ skipped: false })
    mockLimit.mockResolvedValueOnce({
      data: [{ id: 'cert-1' }, { id: 'cert-2' }, { id: 'cert-3' }],
      error: null,
    })

    const res = await POST(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, succeeded: 2, failed: 1 })
    expect(mockRetryPhaseA).toHaveBeenCalledTimes(3)
  })
})
