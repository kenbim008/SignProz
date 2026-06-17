import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DocumentService, isServiceError, serviceErrorToStatus } from '@/services'
import { createDocumentSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'
import DOMPurify from 'isomorphic-dompurify'
import type { DocumentStatus } from '@/lib/types'

const VALID_STATUSES: readonly DocumentStatus[] = [
  'draft',
  'sent',
  'partially_signed',
  'completed',
  'expired',
] as const

function parseStatus(raw: string | null): DocumentStatus | undefined {
  if (!raw) return undefined
  return VALID_STATUSES.includes(raw as DocumentStatus) ? (raw as DocumentStatus) : undefined
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '20', 10)
  const status = parseStatus(searchParams.get('status'))

  try {
    const result = await DocumentService.list(session.id, { page, limit, status })
    return NextResponse.json(result)
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.list.rejected', { userId: session.id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.list.error', err, { userId: session.id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = createDocumentSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Sanitize the HTML content (security: prevent stored XSS)
  const sanitizedContent = parsed.data.content
    ? DOMPurify.sanitize(parsed.data.content, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'span', 'div',
          'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'a', 'img',
        ],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'target'],
        ALLOW_DATA_ATTR: false,
      })
    : null

  // The route accepts signers + fields in the same POST body (outside the Zod schema).
  // Read the raw body and pass through whatever the caller sent.
  const rawBody = (await request.clone().json()) as {
    signers?: Array<{ email: string; name: string; order?: number }>
    fields?: Array<{
      field_type: string
      position_x: number
      position_y: number
      width?: number
      height?: number
      signer_index: number
      is_required?: boolean
      page_number?: number
      label?: string
    }>
  }

  try {
    const document = await DocumentService.create(session.id, {
      title: parsed.data.title,
      content: sanitizedContent,
      template_id: parsed.data.template_id,
      expiration_days: parsed.data.expiration_days,
      signers: rawBody.signers ?? [],
      fields: rawBody.fields ?? [],
    })
    return NextResponse.json({ document }, { status: 201 })
  } catch (err) {
    if (isServiceError(err)) {
      logger.warn('documents.create.rejected', { userId: session.id, code: err.code })
      return NextResponse.json({ error: err.message }, { status: serviceErrorToStatus(err.code) })
    }
    logger.error('documents.create.error', err, { userId: session.id })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
