import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await DocumentService.sendForSigning(id, session.id)
    return NextResponse.json(result)
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.send.rejected', { userId: session.id, documentId: id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.send.error', err, { userId: session.id, documentId: id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
