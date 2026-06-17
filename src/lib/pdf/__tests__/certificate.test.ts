import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderCertificatePdf } from '@/lib/pdf/certificate'
import type { Certificate, JsonManifest } from '@/lib/pdf/certificate'

const sampleCert: Certificate = {
  id: '00000000-0000-0000-0000-000000000001',
  documentId: '00000000-0000-0000-0000-000000000002',
  contentHashAtSend: Buffer.from('a'.repeat(64)),
  contentHashAtCompletion: Buffer.from('b'.repeat(64)),
  chainRootHash: Buffer.from('c'.repeat(64)),
  merkleRootAtCompletion: null,
  pdfStoragePath: null,
  tstToken: null,
  createdAt: new Date('2026-06-16T12:00:00Z'),
  tsaIssuedAt: null,
}

const sampleManifest: JsonManifest = {
  documentId: '00000000-0000-0000-0000-000000000002',
  documentTitle: 'Test Agreement',
  completedAt: '2026-06-16T12:00:00Z',
  signers: [
    { name: 'Alice', email: 'alice@example.com', signedAt: '2026-06-16T11:55:00Z' },
  ],
  auditChain: [],
  contentHashAtSend: 'a'.repeat(64),
  contentHashAtCompletion: 'b'.repeat(64),
}

describe('renderCertificatePdf', () => {
  it('returns a non-empty PDF buffer', async () => {
    const pdf = await renderCertificatePdf(sampleCert, sampleManifest)
    expect(pdf.length).toBeGreaterThan(100)
    // PDF files start with %PDF
    expect(pdf.slice(0, 4).toString()).toBe('%PDF')
  })

  it('generates a single-page US Letter PDF', async () => {
    const pdf = await renderCertificatePdf(sampleCert, sampleManifest)
    const loaded = await PDFDocument.load(pdf)
    expect(loaded.getPageCount()).toBe(1)
    expect(loaded.getPage(0).getWidth()).toBe(612)
    expect(loaded.getPage(0).getHeight()).toBe(792)
  })

  it('embeds the document title as PDF metadata', async () => {
    const pdf = await renderCertificatePdf(sampleCert, sampleManifest)
    const loaded = await PDFDocument.load(pdf)
    expect(loaded.getTitle()).toBe('Test Agreement')
  })
})
