import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService } from '@/services'
import { apiErrorResponse, apiError500, apiUnauthorized } from '@/lib/api-errors'

interface RouteParams {
  params: Promise<{ id: string; signerId: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id: documentId, signerId } = await params
  const session = await getSession()
  if (!session) {
    return apiUnauthorized()
  }

  try {
    await DocumentService.resendSignerInvite(documentId, session.id, signerId)
    return NextResponse.json({ success: true, message: 'Magic link resent successfully' })
  } catch (err) {
    return (
      apiErrorResponse(err, { endpoint: 'resend', userId: session.id, documentId, signerId }, { forbidToNotFound: true }) ??
      apiError500(err, { endpoint: 'resend', userId: session.id, documentId, signerId })
    )
  }
}
