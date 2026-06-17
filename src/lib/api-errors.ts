/**
 * API error response helpers.
 *
 * Routes that are document-scoped (e.g., /documents/[id]/*) use remapServiceError()
 * to convert FORBIDDEN into a 404 with a generic message. This prevents an
 * attacker from distinguishing "document does not exist" from "document exists
 * but belongs to another user" by reading the HTTP status code.
 */

import { isServiceError, serviceErrorToStatus } from '@/services/errors'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

/**
 * If `err` is a ServiceError, return a NextResponse that maps the code to an
 * HTTP status and returns the message. Otherwise, return null so the caller
 * can fall through to the generic 500 path.
 *
 * `context` is included in the warn log for rejected errors.
 * `forbidToNotFound` should be true on document-scoped routes (e.g., the
 * /documents/[id] family) to avoid the existence-vs-ownership info leak.
 */
export function apiErrorResponse(
  err: unknown,
  context: Record<string, unknown>,
  options: { forbidToNotFound?: boolean } = {}
): NextResponse | null {
  if (!isServiceError(err)) return null

  // On document-scoped routes, remap FORBIDDEN → NOT_FOUND with a generic
  // message to avoid leaking whether a document exists.
  let code = err.code
  let message = err.message
  if (options.forbidToNotFound && code === 'FORBIDDEN') {
    code = 'NOT_FOUND'
    message = 'Document not found'
  }

  logger.warn(`${(context.endpoint as string) || 'api'}.rejected`, {
    ...context,
    code,
    // Preserve the original code for incident response. The response is
    // 404/NOT_FOUND, but if it was originally a FORBIDDEN (ownership mismatch)
    // we want to know — that's a different signal than "truly missing".
    originalCode: err.code,
  })
  return NextResponse.json(
    { error: message, ...err.details },
    { status: serviceErrorToStatus(code) }
  )
}

export function apiError500(err: unknown, context: Record<string, unknown>): NextResponse {
  logger.error(`${(context.endpoint as string) || 'api'}.error`, err, context)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export function apiUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
