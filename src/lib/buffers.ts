/**
 * Normalize a hex-string-or-Buffer value to a Buffer.
 *
 * The supabase admin client has no custom transformer, so PostgREST may
 * return BYTEA columns as either Buffer or as a hex-encoded string depending
 * on the driver. This helper collapses both shapes to a single Buffer.
 *
 * Returns `null` for null/undefined so that nullable BYTEA columns
 * (e.g. `merkle_root_at_completion`, `tst_token`) keep their nullness
 * instead of silently being coerced to a 0-length Buffer. The pre-M4
 * inline ternary `x instanceof Buffer ? x : Buffer.from(x, 'hex')` would
 * return `Buffer.alloc(0)` for null/undefined, which is a different
 * value and could break downstream `!buf` / `buf.length` checks.
 */
export function toBuffer(value: Buffer | string | null | undefined): Buffer | null {
  if (value == null) return null
  if (value instanceof Buffer) return value
  return Buffer.from(value as string, 'hex')
}
