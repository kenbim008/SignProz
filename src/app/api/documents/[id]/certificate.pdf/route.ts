import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, EvidenceService } from '@/services'
import { apiErrorResponse, apiError500, apiUnauthorized } from '@/lib/api-errors'
import { head } from '@vercel/blob'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) return apiUnauthorized()

  // Verify ownership (document-scoped route -- remap FORBIDDEN to 404).
  // The PDF route is an alternate access path to the certificate, so it must
  // enforce the same ownership check as the JSON /certificate route. Without
  // this, any authenticated user could download any other user's certificate
  // PDF by knowing the document id.
  try {
    await DocumentService.validateOwnership(id, session.id)
  } catch (err) {
    return (
      apiErrorResponse(err, { endpoint: 'certificate.pdf', documentId: id, userId: session.id }, { forbidToNotFound: true }) ??
      apiError500(err, { endpoint: 'certificate.pdf', documentId: id, userId: session.id })
    )
  }

  const cert = await EvidenceService.getCertificate(id)
  if (!cert || !cert.pdfStoragePath) {
    return NextResponse.json({ error: 'Certificate PDF not available' }, { status: 404 })
  }

  try {
    const blob = await head(cert.pdfStoragePath)
    const pdfRes = await fetch(blob.url)
    const pdfBuffer = await pdfRes.arrayBuffer()
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="certificate-${id}.pdf"`,
      },
    })
  } catch (err) {
    return apiError500(err, { endpoint: 'certificate.pdf', documentId: id })
  }
}
