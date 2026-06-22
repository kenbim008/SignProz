import { describe, it, expect } from 'vitest'
import { rateLimit } from '../rate-limit'

describe('rateLimit', () => {
  it('allows first request', () => {
    const result = rateLimit('test-key', 5, 60000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks after exceeding max attempts', () => {
    const key = `block-key-${Date.now()}`
    for (let i = 0; i < 5; i++) {
      rateLimit(key, 5, 60000)
    }
    const result = rateLimit(key, 5, 60000)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('resets after window expires', () => {
    const key = `reset-key-${Date.now()}`
    rateLimit(key, 1, 10)
    rateLimit(key, 1, 10)

    return new Promise((resolve) => {
      setTimeout(() => {
        const result = rateLimit(key, 1, 10)
        expect(result.allowed).toBe(true)
        resolve(result)
      }, 20)
    })
  })
})
