import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

vi.mock('@/services', () => ({
  EvidenceService: {
    verifyCertificate: vi.fn().mockResolvedValue({
      valid: true,
      chainOk: true,
      logOk: true,
      tsaOk: true,
      manifest: {
        documentId: 'doc-1',
        documentTitle: 'My Test Document',
        completedAt: '2026-01-01T00:00:00.000Z',
        signers: [
          { name: 'Alice', email: 'alice@example.com', signedAt: '2026-01-01T00:00:00.000Z' },
        ],
        auditChain: [],
        contentHashAtSend: 'a',
        contentHashAtCompletion: 'b',
      },
    }),
  },
}))

import VerifyPage from '@/app/verify/[certificateId]/page'

describe('VerifyPage', () => {
  it('renders the valid state when the certificate verifies cleanly', async () => {
    const element = await VerifyPage({ params: Promise.resolve({ certificateId: 'cert-abc-1234567890' }) })
    const html = renderToString(element as React.ReactElement)

    expect(html).toContain('Certificate Verification')
    expect(html).toContain('cert-abc-1234567890')
    expect(html).toContain('Valid')
    expect(html).toContain('My Test Document')
    expect(html).toContain('alice@example.com')
  })
})
