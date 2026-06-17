import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string; signerId: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id: documentId, signerId } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await DocumentService.resendSignerInvite(documentId, session.id, signerId)
    return NextResponse.json({ success: true, message: 'Magic link resent successfully' })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('resend.rejected', { userId: session.id, documentId, signerId, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('resend.error', err, { userId: session.id, documentId, signerId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
