import { NextResponse } from 'next/server'
import { SigningService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ documentId: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  const { documentId } = await params
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  try {
    const context = await SigningService.getSigningContext(documentId, token)

    // Determine state — the client reads `state` to decide what to render
    let state: string = 'ready'
    if (context.document.status === 'completed') {
      state = 'completed'
    } else {
      // Sequential signing: if any prior-order signer hasn't signed, this signer must wait
      const sortedSigners = [...context.document.signers].sort((a, b) => a.order - b.order)
      const firstUnsigned = sortedSigners.find((s) => !s.signed_at)
      if (firstUnsigned && firstUnsigned.id !== context.signer.id) {
        state = 'sequential_wait'
      }
    }

    return NextResponse.json({ state, ...context })
  } catch (err) {
    if (isServiceError(err)) {
      // Map specific codes to the old `state` field shape so the client doesn't break
      const state =
        err.code === 'CONFLICT' ? 'already_signed' :
        err.code === 'TOKEN_EXPIRED' ? 'expired' :
        undefined
      logger.warn('sign.context.rejected', { documentId, code: err.code })
      return NextResponse.json(
        { error: err.message, ...err.details, ...(state ? { state } : {}) },
        { status: serviceErrorToStatus(err.code) }
      )
    }
    logger.error('sign.context.error', err, { documentId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
