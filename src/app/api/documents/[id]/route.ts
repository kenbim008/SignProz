import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService } from '@/services'
import { apiErrorResponse, apiError500, apiUnauthorized } from '@/lib/api-errors'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return apiUnauthorized()
  }

  try {
    const document = await DocumentService.get(id, session.id)
    return NextResponse.json({ document })
  } catch (err) {
    return (
      apiErrorResponse(err, { endpoint: 'documents.get', userId: session.id, documentId: id }, { forbidToNotFound: true }) ??
      apiError500(err, { endpoint: 'documents.get', userId: session.id, documentId: id })
    )
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
    return apiUnauthorized()
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
    return (
      apiErrorResponse(err, { endpoint: 'documents.update', userId: session.id, documentId: id }, { forbidToNotFound: true }) ??
      apiError500(err, { endpoint: 'documents.update', userId: session.id, documentId: id })
    )
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return apiUnauthorized()
  }

  try {
    await DocumentService.delete(id, session.id)
    return NextResponse.json({ message: 'Document deleted' })
  } catch (err) {
    return (
      apiErrorResponse(err, { endpoint: 'documents.delete', userId: session.id, documentId: id }, { forbidToNotFound: true }) ??
      apiError500(err, { endpoint: 'documents.delete', userId: session.id, documentId: id })
    )
  }
}
