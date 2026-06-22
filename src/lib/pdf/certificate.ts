import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface Certificate {
  id: string
  documentId: string
  contentHashAtSend: Buffer
  contentHashAtCompletion: Buffer
  chainRootHash: Buffer
  merkleRootAtCompletion: Buffer | null
  pdfStoragePath: string | null
  tstToken: Buffer | null
  createdAt: Date
  tsaIssuedAt: Date | null
}

export interface JsonManifest {
  documentId: string
  documentTitle: string
  completedAt: string
  signers: Array<{ name: string | null; email: string; signedAt: string | null }>
  auditChain: Array<{ action: string; actorEmail: string | null; createdAt: string }>
  contentHashAtSend: string
  contentHashAtCompletion: string
}

export async function renderCertificatePdf(
  cert: Certificate,
  manifest: JsonManifest,
): Promise<Buffer> {
  const pdf = await PDFDocument.create()

  // Set document metadata
  pdf.setTitle(manifest.documentTitle)
  pdf.setSubject('Certificate of Completion')
  pdf.setCreator('SignProz')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const page = pdf.addPage([612, 792]) // US Letter
  let y = 750

  // Title
  page.drawText('Certificate of Completion', {
    x: 50,
    y,
    size: 24,
    font: bold,
    color: rgb(0, 0, 0),
  })
  y -= 40

  // Document title
  page.drawText(manifest.documentTitle, { x: 50, y, size: 16, font })
  y -= 30

  // Metadata
  page.drawText(`Document ID: ${manifest.documentId}`, { x: 50, y, size: 10, font })
  y -= 20
  page.drawText(`Certificate ID: ${cert.id}`, { x: 50, y, size: 10, font })
  y -= 20
  page.drawText(`Completed at: ${manifest.completedAt}`, { x: 50, y, size: 10, font })
  y -= 40

  // Signers section
  page.drawText('Signers', { x: 50, y, size: 14, font: bold })
  y -= 20
  for (const s of manifest.signers) {
    page.drawText(`${s.name || s.email} <${s.email}>`, { x: 70, y, size: 10, font })
    y -= 14
    if (s.signedAt) {
      page.drawText(`  Signed: ${s.signedAt}`, {
        x: 70,
        y,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      })
      y -= 14
    }
  }
  y -= 20

  // Hashes section
  page.drawText('Integrity Hashes', { x: 50, y, size: 14, font: bold })
  y -= 20
  page.drawText(`Content at send: ${cert.contentHashAtSend.toString('hex').slice(0, 32)}...`, {
    x: 70,
    y,
    size: 9,
    font,
  })
  y -= 14
  page.drawText(
    `Content at completion: ${cert.contentHashAtCompletion.toString('hex').slice(0, 32)}...`,
    { x: 70, y, size: 9, font },
  )
  y -= 14
  page.drawText(`Audit chain root: ${cert.chainRootHash.toString('hex').slice(0, 32)}...`, {
    x: 70,
    y,
    size: 9,
    font,
  })
  y -= 30

  // Verification URL
  page.drawText('Verify this certificate at:', { x: 50, y, size: 10, font })
  y -= 14
  page.drawText(`/verify/${cert.id}`, {
    x: 70,
    y,
    size: 10,
    font,
    color: rgb(0, 0, 0.8),
  })

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
