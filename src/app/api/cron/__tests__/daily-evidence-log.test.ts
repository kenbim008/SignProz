import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const mockAppendDailyLogEntry = vi.fn()

vi.mock('@/services', () => ({
  EvidenceService: {
    appendDailyLogEntry: (...args: unknown[]) => mockAppendDailyLogEntry(...args),
  },
}))

const GET = (await import('@/app/api/cron/daily-evidence-log/route')).GET

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret-12345'
})

beforeEach(() => {
  mockAppendDailyLogEntry.mockReset()
  mockAppendDailyLogEntry.mockResolvedValue(undefined)
})

function makeRequest(authHeader: string | null): Request {
  const headers = new Headers()
  if (authHeader !== null) headers.set('authorization', authHeader)
  return new Request('http://localhost/api/cron/daily-evidence-log', { headers })
}

describe('GET /api/cron/daily-evidence-log', () => {
  it('returns 401 when authorization header is missing', async () => {
    const res = await GET(makeRequest(null))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(mockAppendDailyLogEntry).not.toHaveBeenCalled()
  })

  it('returns 401 when authorization header has the wrong value', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret-12345'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(mockAppendDailyLogEntry).not.toHaveBeenCalled()
  })

  it('returns 401 when authorization header is a different scheme', async () => {
    const res = await GET(makeRequest(`Basic ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(401)
    expect(mockAppendDailyLogEntry).not.toHaveBeenCalled()
  })

  it('returns 200 and calls appendDailyLogEntry on success', async () => {
    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockAppendDailyLogEntry).toHaveBeenCalledTimes(1)
    const arg = mockAppendDailyLogEntry.mock.calls[0][0] as Date
    expect(arg).toBeInstanceOf(Date)
  })

  it('returns 500 when appendDailyLogEntry throws', async () => {
    mockAppendDailyLogEntry.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed' })
  })
})
