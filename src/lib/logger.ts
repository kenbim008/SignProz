/**
 * Thin structured JSON logger.
 *
 * Emits one JSON object per line to stdout (or stderr for warn/error).
 * Vercel captures stdout/stderr and indexes JSON automatically.
 *
 * No external dependencies — keeps the bundle small and the surface area minimal.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.info('document created', { documentId: '123' })
 *   logger.error('signing failed', error, { documentId: '123' })
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

  const line = JSON.stringify(entry)

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
  error(msg: string, error?: unknown, meta?: LogFields) {
    emit('error', msg, meta, error)
  },
}
