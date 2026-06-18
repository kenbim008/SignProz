import { describe, it, expect } from 'vitest'
import { toBuffer } from '@/lib/buffers'

describe('toBuffer', () => {
  it('returns the same Buffer instance when given a Buffer', () => {
    const input = Buffer.from('aabbcc', 'hex')
    const result = toBuffer(input)
    expect(result).toBe(input) // same reference
  })

  it('converts a hex string to a Buffer of the correct byte length', () => {
    const hex = 'aa'.repeat(32) // 64 hex chars = 32 bytes
    const result = toBuffer(hex)
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result!.length).toBe(32)
    expect(result!.toString('hex')).toBe(hex)
  })

  it('returns null for null input (preserves nullness)', () => {
    // M4 fix: the pre-M4 inline ternary returned Buffer.alloc(0) for
    // null, which was a different value. The new helper preserves null.
    expect(toBuffer(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(toBuffer(undefined)).toBeNull()
  })

  it('returns a 0-length Buffer for an empty string', () => {
    // Empty string is a non-null non-undefined value, so it does not
    // hit the null guard. Buffer.from('', 'hex') returns an empty
    // buffer; this matches the pre-M4 behavior for that case.
    const result = toBuffer('')
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result!.length).toBe(0)
  })
})
