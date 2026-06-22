import { timingSafeEqual } from 'node:crypto'

/**
 * Authorize a cron request by comparing the Bearer token against CRON_SECRET
 * with constant-time comparison. Returns false if either side is missing or
 * the lengths differ.
 */
export function isAuthorized(req: Request): boolean {
  const auth = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!auth || !process.env.CRON_SECRET) return false
  const a = Buffer.from(auth)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
