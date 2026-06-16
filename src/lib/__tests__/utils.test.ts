import { describe, it, expect } from 'vitest'
import { isTokenExpired, isSequentialSigning } from '@/lib/utils'

describe('isTokenExpired', () => {
  it('returns true for past dates', () => {
    const past = new Date(Date.now() - 10000).toISOString()
    expect(isTokenExpired(past)).toBe(true)
  })

  it('returns false for future dates', () => {
    const future = new Date(Date.now() + 10000).toISOString()
    expect(isTokenExpired(future)).toBe(false)
  })
})

describe('isSequentialSigning', () => {
  it('returns false when all signers have order 0', () => {
    const signers: { order: number }[] = [
      { order: 0 },
      { order: 0 },
    ]
    expect(isSequentialSigning(signers)).toBe(false)
  })

  it('returns true when any signer has order > 0', () => {
    const signers: { order: number }[] = [
      { order: 0 },
      { order: 1 },
    ]
    expect(isSequentialSigning(signers)).toBe(true)
  })
})
