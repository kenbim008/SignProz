import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestTimestamp, TsaError } from '@/lib/tsa/freetsa'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch
})

afterEach(() => {
  delete (globalThis as any).fetch
})

describe('requestTimestamp', () => {
  it('posts to FreeTSA and returns the token bytes', async () => {
    const derBytes = new Uint8Array([
      0x30, 0x0e, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x04, 0x06, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    ])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => derBytes.buffer,
    })

    const token = await requestTimestamp({
      documentHash: Buffer.from('hash-of-content'),
      tsaUrl: 'https://freetsa.org/tsr',
    })

    expect(token).toEqual(Buffer.from(derBytes))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe('https://freetsa.org/tsr')
  })

  it('retries on 5xx with exponential backoff', async () => {
    const derBytes = new Uint8Array([
      0x30, 0x0e, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x04, 0x06, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    ])
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => derBytes.buffer })

    const token = await requestTimestamp({
      documentHash: Buffer.from('hash'),
      tsaUrl: 'https://tsa',
      maxRetries: 3,
      baseDelayMs: 1,
    })

    expect(token).toEqual(Buffer.from(derBytes))
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('throws TsaError after exhausting retries', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })

    await expect(
      requestTimestamp({
        documentHash: Buffer.from('hash'),
        tsaUrl: 'https://tsa',
        maxRetries: 2,
        baseDelayMs: 1,
      })
    ).rejects.toThrow(TsaError)
  })

  it('throws TsaError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      requestTimestamp({
        documentHash: Buffer.from('hash'),
        tsaUrl: 'https://tsa',
        maxRetries: 1,
        baseDelayMs: 1,
      })
    ).rejects.toThrow(TsaError)
  })
})
