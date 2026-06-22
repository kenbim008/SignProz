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

  it('M7: per-attempt timeout aborts the fetch and surfaces as TsaError', async () => {
    // Simulate a hung TCP connection. The mock fetch returns a promise
    // that rejects when the AbortSignal aborts (mimicking real fetch
    // behavior under abort). With a 50ms timeout, requestTimestamp
    // should abort, exhaust the retries, and throw TsaError.
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal
        if (sig) {
          if (sig.aborted) {
            reject(new Error('aborted'))
          } else {
            sig.addEventListener('abort', () => reject(new Error('aborted')))
          }
        }
      })
    })

    const start = Date.now()
    await expect(
      requestTimestamp({
        documentHash: Buffer.from('hash'),
        tsaUrl: 'https://tsa',
        maxRetries: 3,
        baseDelayMs: 1,
        timeoutMs: 50,
      })
    ).rejects.toThrow(TsaError)
    const elapsed = Date.now() - start

    // Generous upper bound: 3 attempts × 50ms timeout + a few ms of
    // bookkeeping. If the timeout were not honored, this would block
    // indefinitely.
    expect(elapsed).toBeLessThan(2000)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('M7: timeoutMs option is plumbed to AbortController', async () => {
    // Verify the fetch call is made with a signal that gets aborted when
    // the timeout elapses. The mock fetch listens for the abort event so
    // we can inspect signal state.
    const signals: AbortSignal[] = []
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const sig = init?.signal
      if (sig) signals.push(sig)
      return new Promise((_resolve, reject) => {
        if (sig) {
          if (sig.aborted) reject(new Error('aborted'))
          else sig.addEventListener('abort', () => reject(new Error('aborted')))
        }
      })
    })

    await expect(
      requestTimestamp({
        documentHash: Buffer.from('hash'),
        tsaUrl: 'https://tsa',
        maxRetries: 1,
        baseDelayMs: 1,
        timeoutMs: 30,
      })
    ).rejects.toThrow(TsaError)

    // Exactly one signal was passed (single attempt) and it was aborted.
    expect(signals.length).toBe(1)
    expect(signals[0].aborted).toBe(true)
  })
})
