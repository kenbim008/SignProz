import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, EvidenceService } from '@/services'
import { apiErrorResponse, apiError500, apiUnauthorized } from '@/lib/api-errors'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) return apiUnauthorized()

  // Verify ownership (document-scoped route — remap FORBIDDEN to 404)
  try {
    await DocumentService.validateOwnership(id, session.id)
  } catch (err) {
    return (
      apiErrorResponse(err, { endpoint: 'certificate.get', documentId: id, userId: session.id }, { forbidToNotFound: true }) ??
      apiError500(err, { endpoint: 'certificate.get', documentId: id, userId: session.id })
    )
  }

  const cert = await EvidenceService.getCertificate(id)
  if (!cert) {
    return NextResponse.json({ error: 'No certificate for this document' }, { status: 404 })
  }

  return NextResponse.json({ certificate: cert })
}
