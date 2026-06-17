import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService } from '@/services'
import { apiErrorResponse, apiError500, apiUnauthorized } from '@/lib/api-errors'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return apiUnauthorized()
  }

  try {
    const result = await DocumentService.sendForSigning(id, session.id)
    return NextResponse.json(result)
  } catch (err) {
    return (
      apiErrorResponse(err, { endpoint: 'documents.send', userId: session.id, documentId: id }, { forbidToNotFound: true }) ??
      apiError500(err, { endpoint: 'documents.send', userId: session.id, documentId: id })
    )
  }
}
