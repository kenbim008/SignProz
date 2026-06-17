import { NextResponse } from 'next/server'
import { SigningService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id: documentId } = await params
  const body = (await request.json()) as { token?: string; fields?: unknown[] }

  if (!body.token || !Array.isArray(body.fields)) {
    return NextResponse.json(
      { error: 'Invalid request: token and fields are required' },
      { status: 400 }
    )
  }

  try {
    const result = await SigningService.signDocument(
      documentId,
      body.token,
      body.fields as Array<{ fieldId: string; value: unknown }>
    )
    return NextResponse.json({
      message: 'Signature submitted',
      ...result,
    })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.sign.rejected', { documentId, code: err.code })
      return NextResponse.json(
        { error: err.message, ...err.details },
        { status: serviceErrorToStatus(err.code) }
      )
    }
    logger.error('documents.sign.error', err, { documentId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
