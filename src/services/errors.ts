/**
 * Service-layer error types and a Result helper.
 *
 * Routes catch ServiceError and map codes to HTTP status. Services throw
 * ServiceError on validation/conflict/etc.; unexpected errors are thrown
 * as-is so they bubble to Sentry.
 */

export type ServiceErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'TOKEN_EXPIRED'
  | 'SEQUENTIAL_ORDER'
  | 'INTERNAL'

export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export function isServiceError(err: unknown): err is ServiceError {
  return err instanceof ServiceError
}

export function serviceErrorToStatus(code: ServiceErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'CONFLICT':
      return 409
    case 'VALIDATION':
      return 400
    case 'TOKEN_EXPIRED':
      return 410
    case 'SEQUENTIAL_ORDER':
      return 409
    case 'INTERNAL':
    default:
      return 500
  }
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError }
