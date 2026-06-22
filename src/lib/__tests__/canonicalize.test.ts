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

  it('omits chain_key (F3.4): row with chain_key matches row without (matches PL/pgSQL canonical_audit_json)', () => {
    // The audit_logs.chain_key column is GENERATED ALWAYS AS (document_id::text)
    // STORED. PL/pgSQL canonical_audit_json strips it (along with prev_hash/hash);
    // JS must do the same so both layers produce the same canonical string for
    // the same logical row. Without this fix, JS and SQL would diverge for
    // every row that gets re-read with the generated column populated.
    const withChainKey = canonicalizeAuditRow({
      id: 'row-1',
      document_id: 'doc-1',
      action: 'document_created',
      actor_email: 'a@x.com',
      created_at: '2026-06-16T12:00:00.000Z',
      chain_key: 'doc-1',
      prev_hash: null,
      hash: null,
    } as any)
    const withoutChainKey = canonicalizeAuditRow({
      id: 'row-1',
      document_id: 'doc-1',
      action: 'document_created',
      actor_email: 'a@x.com',
      created_at: '2026-06-16T12:00:00.000Z',
    } as any)
    expect(withChainKey).toBe(withoutChainKey)
    expect(withChainKey).not.toContain('chain_key')
  })
})
