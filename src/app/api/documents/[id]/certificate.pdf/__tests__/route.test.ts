/**
 * Tests for the certificate PDF route.
 *
 * F3.1: The route previously had no ownership check, so any authenticated
 * user could fetch any other user's certificate PDF. These tests pin the
 * fix: a non-owner must receive a 404 (remapped from FORBIDDEN so the
 * existence-vs-ownership distinction is not leaked), and a session-less
 * request must still get a 401.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the auth + services + blob layer. Each test sets its own return values.
const mockGetSession = vi.fn()
const mockValidateOwnership = vi.fn()
const mockGetCertificate = vi.fn()
const mockHead = vi.fn()

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/services', () => ({
  DocumentService: {
    validateOwnership: (...args: unknown[]) => mockValidateOwnership(...args),
  },
  EvidenceService: {
    getCertificate: (...args: unknown[]) => mockGetCertificate(...args),
  },
}))

vi.mock('@vercel/blob', () => ({
  head: (...args: unknown[]) => mockHead(...args),
}))

// Import ServiceError so mocked validateOwnership can throw the real type --
// the production code uses `isServiceError(err)` (instanceof) to detect errors.
import { ServiceError } from '@/services/errors'

const GET = (await import('@/app/api/documents/[id]/certificate.pdf/route')).GET

beforeEach(() => {
  mockGetSession.mockReset()
  mockValidateOwnership.mockReset()
  mockGetCertificate.mockReset()
  mockHead.mockReset()
})

function makeRequest(): Request {
  return new Request('http://localhost/api/documents/doc-1/certificate.pdf')
}

describe('GET /api/documents/[id]/certificate.pdf', () => {
  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(401)
    expect(mockValidateOwnership).not.toHaveBeenCalled()
    expect(mockGetCertificate).not.toHaveBeenCalled()
  })

  it('returns 404 (not 200) when a non-owner calls the route (F3.1)', async () => {
    // Session is valid, but validateOwnership throws FORBIDDEN (the user
    // does not own doc-1). The route must remap FORBIDDEN to 404 so the
    // existence-vs-ownership distinction is not leaked, and must NOT
    // call EvidenceService.getCertificate or fetch the PDF.
    mockGetSession.mockResolvedValue({ id: 'attacker-id' })
    mockValidateOwnership.mockRejectedValue(
      new ServiceError('FORBIDDEN', 'You do not own this document'),
    )

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Document not found')
    expect(mockGetCertificate).not.toHaveBeenCalled()
    expect(mockHead).not.toHaveBeenCalled()
  })

  it('returns 404 (not 200) when the document does not exist (NOT_FOUND)', async () => {
    // validateOwnership throws NOT_FOUND when the document is missing. The
    // route must surface that as a 404, not call EvidenceService.getCertificate.
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockValidateOwnership.mockRejectedValue(
      new ServiceError('NOT_FOUND', 'Document not found'),
    )

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(404)
    expect(mockGetCertificate).not.toHaveBeenCalled()
    expect(mockHead).not.toHaveBeenCalled()
  })

  it('returns the PDF when the owner calls the route', async () => {
    // Happy path: session present, ownership validates, cert + pdf_path
    // exist, blob head returns a URL, fetch returns PDF bytes.
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockValidateOwnership.mockResolvedValue({ id: 'doc-1', user_id: 'user-1', status: 'completed' })
    mockGetCertificate.mockResolvedValue({
      id: 'cert-1',
      documentId: 'doc-1',
      contentHashAtSend: Buffer.alloc(32),
      contentHashAtCompletion: Buffer.alloc(32),
      chainRootHash: Buffer.alloc(32),
      merkleRootAtCompletion: null,
      pdfStoragePath: 'certificates/cert-1.pdf',
      tstToken: null,
      createdAt: new Date(),
      tsaIssuedAt: null,
    })
    mockHead.mockResolvedValue({ url: 'https://blob.test/cert-1.pdf' })
    // Stub global fetch
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
    }) as unknown as typeof fetch

    try {
      const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
    } finally {
      global.fetch = originalFetch
    }
  })
})
