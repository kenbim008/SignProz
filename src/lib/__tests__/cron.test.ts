import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isAuthorized } from '@/lib/cron'

function makeRequest(authHeader: string | null): Request {
  const headers = new Headers()
  if (authHeader !== null) headers.set('authorization', authHeader)
  return new Request('http://localhost/api/cron/test', { headers })
}

describe('isAuthorized', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret-12345'
  })
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('returns false when CRON_SECRET is missing', () => {
    delete process.env.CRON_SECRET
    expect(isAuthorized(makeRequest('Bearer test-secret-12345'))).toBe(false)
  })

  it('returns false when Authorization header is missing', () => {
    expect(isAuthorized(makeRequest(null))).toBe(false)
  })

  it('returns false when scheme is not Bearer', () => {
    expect(isAuthorized(makeRequest(`Basic test-secret-12345`))).toBe(false)
  })

  it('returns false when length differs (wrong token length)', () => {
    expect(isAuthorized(makeRequest('Bearer too-short'))).toBe(false)
  })

  it('returns false when the token is wrong but same length', () => {
    // 'Bearer wrong-secret-12345' is the same length as 'Bearer test-secret-12345'
    expect(isAuthorized(makeRequest('Bearer wrong-secret-12345'))).toBe(false)
  })

  it('returns true for a valid Bearer token', () => {
    expect(isAuthorized(makeRequest(`Bearer ${process.env.CRON_SECRET}`))).toBe(true)
  })
})
