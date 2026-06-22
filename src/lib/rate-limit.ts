// src/lib/rate-limit.ts
const rateMap = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 60000
): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = rateMap.get(key)

  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxAttempts - 1 }
  }

  entry.count++
  if (entry.count > maxAttempts) {
    return { allowed: false, remaining: 0 }
  }

  return { allowed: true, remaining: maxAttempts - entry.count }
}

// Periodic cleanup to prevent memory leak
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateMap) {
      if (now > entry.resetAt) rateMap.delete(key)
    }
  }, 60000)
}
