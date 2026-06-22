/**
 * Thin Sentry helpers that no-op when SENTRY_DSN is unset.
 *
 * The Sentry SDK itself is a no-op without a DSN, so these wrappers are
 * mainly for typing and for adding context (breadcrumbs) consistently.
 */

import * as Sentry from '@sentry/nextjs'

export function captureException(error: unknown, context?: Record<string, unknown>) {
  Sentry.captureException(error, { extra: context })
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  Sentry.captureMessage(message, level)
}

export function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({ category, message, data, level: 'info' })
}
