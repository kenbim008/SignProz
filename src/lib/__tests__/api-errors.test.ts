import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ServiceError } from '@/services/errors'
import { apiErrorResponse, apiError500, apiUnauthorized } from '@/lib/api-errors'

describe('apiErrorResponse', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when err is not a ServiceError', () => {
    expect(apiErrorResponse(new Error('boom'), { endpoint: 'x' })).toBeNull()
  })

  it('returns a 4xx response with the error message for a ServiceError', async () => {
    const res = apiErrorResponse(
      new ServiceError('VALIDATION', 'Missing field'),
      { endpoint: 'documents.create', userId: 'u1' }
    )
    expect(res).not.toBeNull()
    const body = await res!.json()
    expect(res!.status).toBe(400)
    expect(body.error).toBe('Missing field')
  })

  it('returns a 404 with a generic message when FORBIDDEN is remapped', async () => {
    const res = apiErrorResponse(
      new ServiceError('FORBIDDEN', 'You do not own this document'),
      { endpoint: 'documents.get', userId: 'u1', documentId: 'd1' },
      { forbidToNotFound: true }
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(404)
    const body = await res!.json()
    expect(body.error).toBe('Document not found')
    // Original message must NOT leak
    expect(body.error).not.toContain('do not own')
  })

  it('does NOT remap FORBIDDEN when forbidToNotFound is not set', async () => {
    const res = apiErrorResponse(
      new ServiceError('FORBIDDEN', 'You do not own this document'),
      { endpoint: 'documents.get', userId: 'u1', documentId: 'd1' }
    )
    expect(res!.status).toBe(403)
    const body = await res!.json()
    expect(body.error).toBe('You do not own this document')
  })

  it('merges err.details into the response body', async () => {
    const err = new ServiceError('CONFLICT', 'Already signed', { signedAt: '2024-01-01' })
    const res = apiErrorResponse(err, { endpoint: 'sign' })
    const body = await res!.json()
    expect(body.error).toBe('Already signed')
    expect(body.signedAt).toBe('2024-01-01')
  })

  it('emits a warn log with the (possibly remapped) code and preserves originalCode', () => {
    apiErrorResponse(
      new ServiceError('FORBIDDEN', 'private'),
      { endpoint: 'documents.get', userId: 'u1', documentId: 'd1' },
      { forbidToNotFound: true }
    )
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const arg = warnSpy.mock.calls[0][0]
    const parsed = JSON.parse(arg)
    expect(parsed.level).toBe('warn')
    expect(parsed.msg).toBe('documents.get.rejected')
    expect(parsed.code).toBe('NOT_FOUND') // remapped
    expect(parsed.originalCode).toBe('FORBIDDEN') // preserved for incident response
    expect(parsed.userId).toBe('u1')
    expect(parsed.documentId).toBe('d1')
  })

  it('leaves code and originalCode equal when no remap occurs', () => {
    apiErrorResponse(
      new ServiceError('CONFLICT', 'already signed'),
      { endpoint: 'sign', documentId: 'd1' }
    )
    const arg = warnSpy.mock.calls[0][0]
    const parsed = JSON.parse(arg)
    expect(parsed.code).toBe('CONFLICT')
    expect(parsed.originalCode).toBe('CONFLICT')
  })
})

describe('apiError500', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a 500 with a generic message and logs the error', async () => {
    const res = apiError500(new Error('db down'), { endpoint: 'documents.get', documentId: 'd1' })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Internal error')
  })
})

describe('apiUnauthorized', () => {
  it('returns a 401', async () => {
    const res = apiUnauthorized()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })
})
