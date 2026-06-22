import { describe, it, expect } from 'vitest'
import { merkleRoot } from '@/lib/merkle'
import { createHash } from 'node:crypto'

function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest()
}

function sha256Pair(left: Buffer, right: Buffer): Buffer {
  const h = createHash('sha256')
  h.update(left)
  h.update(right)
  return h.digest()
}

describe('merkleRoot', () => {
  it('returns empty buffer for empty input', () => {
    expect(merkleRoot([]).length).toBe(0)
  })

  it('returns the leaf as-is for a single leaf (no hashing)', () => {
    const leaf = sha256(Buffer.from('a'))
    const root = merkleRoot([leaf])
    expect(root.equals(leaf)).toBe(true)
  })

  it('combines two leaves by hashing left||right', () => {
    const a = sha256(Buffer.from('a'))
    const b = sha256(Buffer.from('b'))
    const expected = sha256Pair(a, b)
    expect(merkleRoot([a, b]).equals(expected)).toBe(true)
  })

  it('combines three leaves (odd level promotes last unchanged)', () => {
    const a = sha256(Buffer.from('a'))
    const b = sha256(Buffer.from('b'))
    const c = sha256(Buffer.from('c'))
    const ab = sha256Pair(a, b)
    const expected = sha256Pair(ab, c)
    expect(merkleRoot([a, b, c]).equals(expected)).toBe(true)
  })

  it('is deterministic for the same input', () => {
    const leaves = [sha256(Buffer.from('a')), sha256(Buffer.from('b')), sha256(Buffer.from('c'))]
    expect(merkleRoot(leaves).equals(merkleRoot(leaves))).toBe(true)
  })

  it('differs when any leaf changes', () => {
    const r1 = merkleRoot([sha256(Buffer.from('a')), sha256(Buffer.from('b'))])
    const r2 = merkleRoot([sha256(Buffer.from('a')), sha256(Buffer.from('B'))])
    expect(r1.equals(r2)).toBe(false)
  })
})
