import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '@/lib/logger'

describe('logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits a JSON line with level, msg, and timestamp to stdout', () => {
    logger.info('user signed in', { userId: 'abc123' })

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const arg = consoleSpy.mock.calls[0][0]
    const parsed = JSON.parse(arg)
    expect(parsed.level).toBe('info')
    expect(parsed.msg).toBe('user signed in')
    expect(parsed.userId).toBe('abc123')
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('redacts keys named password, token, or apiKey', () => {
    logger.info('login attempt', { email: 'a@b.com', password: 'secret123' })

    const arg = consoleSpy.mock.calls[0][0]
    const parsed = JSON.parse(arg)
    expect(parsed.email).toBe('a@b.com')
    expect(parsed.password).toBe('[REDACTED]')
  })

  it('emits warn level to stderr', () => {
    const errSpy = vi.spyOn(console, 'warn')
    logger.warn('rate limit hit', { ip: '1.2.3.4' })

    const arg = errSpy.mock.calls[0][0]
    const parsed = JSON.parse(arg)
    expect(parsed.level).toBe('warn')
    expect(parsed.ip).toBe('1.2.3.4')
  })

  it('emits error level with error stack when an Error is passed', () => {
    const errSpy = vi.spyOn(console, 'error')
    const err = new Error('db connection failed')
    logger.error('query failed', err)

    const arg = errSpy.mock.calls[0][0]
    const parsed = JSON.parse(arg)
    expect(parsed.level).toBe('error')
    expect(parsed.error).toBe('db connection failed')
    expect(parsed.stack).toContain('Error: db connection failed')
  })
})
