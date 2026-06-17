import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, isServiceError, serviceErrorToStatus } from '@/services'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const document = await DocumentService.get(id, session.id)
    return NextResponse.json({ document })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.get.rejected', { userId: session.id, documentId: id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.get.error', err, { userId: session.id, documentId: id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// PUT is kept (backwards compat) — internally routes to DocumentService.update.
// A PATCH alias is also exported so future callers can use the more standard verb.
export async function PUT(request: Request, { params }: RouteParams) {
  return handleUpdate(request, await params)
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleUpdate(request, await params)
}

async function handleUpdate(request: Request, { id }: { id: string }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as {
    title?: string
    content?: string
    expiration_days?: number
  }

  try {
    const document = await DocumentService.update(id, session.id, body)
    return NextResponse.json({ document })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.update.rejected', { userId: session.id, documentId: id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.update.error', err, { userId: session.id, documentId: id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await DocumentService.delete(id, session.id)
    return NextResponse.json({ message: 'Document deleted' })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.delete.rejected', { userId: session.id, documentId: id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.delete.error', err, { userId: session.id, documentId: id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
