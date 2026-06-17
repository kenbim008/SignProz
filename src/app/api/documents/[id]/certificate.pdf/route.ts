import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { EvidenceService } from '@/services'
import { apiError500, apiUnauthorized } from '@/lib/api-errors'
import { head } from '@vercel/blob'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) return apiUnauthorized()

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
