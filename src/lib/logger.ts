/**
 * Thin structured JSON logger.
 *
 * Emits one JSON object per line to stdout (or stderr for warn/error).
 * Vercel captures stdout/stderr and indexes JSON automatically.
 *
 * No external dependencies — keeps the bundle small and the surface area minimal.
 *
 * Note: `debug()` no-ops in production. Top-level meta keys listed in
 * REDACTED_KEYS are replaced with '[REDACTED]'; nested keys are not redacted
 * (pass pre-sanitized objects if you need deeper protection). JSON.stringify
 * failures (e.g., circular references) fall back to a safe representation so
 * a log call never crashes the request handler.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.info('document created', { documentId: '123' })
 *   logger.error('signing failed', { documentId: '123' }, error)
 */

const REDACTED_KEYS = new Set([
  'password',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'secret',
])

type Level = 'debug' | 'info' | 'warn' | 'error'

interface LogFields {
  [key: string]: unknown
}

function redact(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [k, v] of Object.entries(fields)) {
    if (REDACTED_KEYS.has(k)) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = v
    }
  }
  return out
}

function emit(level: Level, msg: string, meta?: LogFields, error?: unknown) {
  const entry: LogFields = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...(meta ? redact(meta) : {}),
  }

  if (error !== undefined) {
    if (error instanceof Error) {
      entry.error = error.message
      if (error.stack) entry.stack = error.stack
    } else {
      entry.error = String(error)
    }
  }

  // JSON.stringify will throw on circular references (e.g., logging a request
  // object with back-references). Fall back to a safe representation so a
  // single log call can't crash the request handler.
  let line: string
  try {
    line = JSON.stringify(entry)
  } catch {
    line = JSON.stringify({
      level,
      msg,
      timestamp: entry.timestamp,
      error: entry.error,
      serializationError: 'meta contained circular references',
    })
  }

  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug(msg: string, meta?: LogFields) {
    if (process.env.NODE_ENV !== 'production') {
      emit('debug', msg, meta)
    }
  },
  info(msg: string, meta?: LogFields) {
    emit('info', msg, meta)
  },
  warn(msg: string, meta?: LogFields) {
    emit('warn', msg, meta)
  },
  /**
   * Log an error. Accepts either:
   *   error(msg, error)               // log an error with no extra context
   *   error(msg, meta, error)         // log an error with structured context
   */
  error(msg: string, metaOrError?: LogFields | unknown, maybeError?: unknown) {
    const isLikelyError = (v: unknown): boolean =>
      v instanceof Error ||
      (typeof v === 'object' && v !== null && 'message' in v && !(v as LogFields).userId && !(v as LogFields).documentId)

    let meta: LogFields | undefined
    let error: unknown

    if (metaOrError === undefined) {
      // no extra args
    } else if (maybeError === undefined && isLikelyError(metaOrError)) {
      error = metaOrError
    } else {
      meta = metaOrError as LogFields
      error = maybeError
    }

    emit('error', msg, meta, error)
  },
}
