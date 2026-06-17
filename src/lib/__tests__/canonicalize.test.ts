import { describe, it, expect } from 'vitest'
import { canonicalizeContent, canonicalizeAuditRow } from '@/lib/canonicalize'

describe('canonicalizeContent', () => {
  it('normalizes CRLF to LF', () => {
    expect(canonicalizeContent('a\r\nb\r\nc')).toBe('a\nb\nc')
  })
  it('strips trailing whitespace per line', () => {
    expect(canonicalizeContent('a   \nb\t\nc')).toBe('a\nb\nc')
  })
  it('trims leading and trailing newlines', () => {
    expect(canonicalizeContent('\n\nhello\n\n')).toBe('hello')
  })
  it('handles null as empty string', () => {
    expect(canonicalizeContent(null)).toBe('')
  })
  it('is deterministic for the same input', () => {
    const a = canonicalizeContent('<p>hello</p>')
    const b = canonicalizeContent('<p>hello</p>')
    expect(a).toBe(b)
  })
})

describe('canonicalizeAuditRow', () => {
  it('sorts keys alphabetically', () => {
    const a = canonicalizeAuditRow({ z: 1, a: 2, m: 3 } as any)
    const b = canonicalizeAuditRow({ a: 2, m: 3, z: 1 } as any)
    expect(a).toBe(b)
    expect(a).toBe('{"a":2,"m":3,"z":1}')
  })
  it('omits prev_hash and hash fields (we hash data, not chain pointers)', () => {
    const out = canonicalizeAuditRow({ id: '1', action: 'foo', prev_hash: 'abc', hash: 'def' } as any)
    expect(out).not.toContain('prev_hash')
    expect(out).not.toContain('hash')
  })
  it('handles nested objects deterministically', () => {
    const a = canonicalizeAuditRow({ metadata: { b: 1, a: 2 } } as any)
    const b = canonicalizeAuditRow({ metadata: { a: 2, b: 1 } } as any)
    expect(a).toBe(b)
  })
  it('serializes Date instances as ISO 8601 strings with millisecond precision', () => {
    const d = new Date('2026-06-16T12:00:00.000Z')
    const out = canonicalizeAuditRow({ created_at: d, action: 'foo' } as any)
    expect(out).toBe('{"action":"foo","created_at":"2026-06-16T12:00:00.000Z"}')
  })

  it('floors ISO timestamps with microsecond precision to milliseconds', () => {
    // Database timestamps may include microsecond digits beyond ms precision.
    // SQL date_trunc('milliseconds', ...) floors them; JS must match.
    const out = canonicalizeAuditRow({
      created_at: '2026-06-16T12:00:00.000500Z',
      action: 'sign',
    } as any)
    expect(out).toBe('{"action":"sign","created_at":"2026-06-16T12:00:00.000Z"}')
  })

  it('floors nested ISO timestamps in metadata', () => {
    const out = canonicalizeAuditRow({
      metadata: { signed_at: '2026-06-16T12:00:00.999800Z' },
      action: 'sign',
    } as any)
    expect(out).toContain('"signed_at":"2026-06-16T12:00:00.999Z"')
  })

  it('leaves non-timestamp strings unchanged', () => {
    const out = canonicalizeAuditRow({ email: 'alice@example.com', action: 'sign' } as any)
    expect(out).toBe('{"action":"sign","email":"alice@example.com"}')
  })

  it('adds .000Z suffix to timestamps with no sub-second precision', () => {
    const out = canonicalizeAuditRow({
      created_at: '2026-06-16T12:00:00Z',
      action: 'sign',
    } as any)
    expect(out).toBe('{"action":"sign","created_at":"2026-06-16T12:00:00.000Z"}')
  })

  it('Date instances produce same output as ISO string timestamps', () => {
    // Date should produce the same canonical form as the corresponding ISO string
    const d = new Date('2026-06-16T12:00:00.000Z')
    const fromDate = canonicalizeAuditRow({ created_at: d, action: 'test' } as any)
    const fromStr = canonicalizeAuditRow({ created_at: '2026-06-16T12:00:00.000Z', action: 'test' } as any)
    expect(fromDate).toBe(fromStr)
  })
})
