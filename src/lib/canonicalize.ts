/**
 * Content canonicalization for hashing.
 * - Normalize line endings (CRLF → LF)
 * - Strip trailing whitespace per line
 * - Trim leading/trailing whitespace overall
 * - null → ''
 * This must match the PL/pgSQL canonical_audit_json semantics.
 */
export function canonicalizeContent(content: string | null | undefined): string {
  if (content == null) return ''
  return content
    .replace(/\r\n/g, '\n')      // CRLF → LF
    .replace(/[ \t]+$/gm, '')     // strip trailing whitespace per line
    .trim()                       // strip leading/trailing whitespace
}

/**
 * Stable JSON representation of an audit row for hashing.
 * - Sorts all keys alphabetically (deep)
 * - Omits prev_hash and hash fields
 * - Floors ISO timestamps to millisecond precision (matching PL/pgSQL
 *   date_trunc('milliseconds', ...) which truncates, not rounds)
 * - Must match PL/pgSQL canonical_audit_json
 */
export function canonicalizeAuditRow(row: Record<string, unknown>): string {
  const { prev_hash, hash, ...data } = row
  return stableStringify(floorTimestamps(data))
}

/**
 * Walk a record and floor ISO 8601 timestamp strings to millisecond precision.
 * This matches PL/pgSQL date_trunc('milliseconds', ...) which truncates
 * sub-millisecond digits rather than rounding.
 */
function floorTimestamps(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      // Floor ISO timestamps to ms: truncate any extra digits after 3-digit ms
      result[key] = value
        .replace(/^(.*\.\d{3})\d*Z$/, '$1Z')
        .replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z$/, '$1.000Z')
    } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
      result[key] = floorTimestamps(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  if (value instanceof Date) {
    // Floor to milliseconds: manual formatting avoids toISOString() rounding
    const y = value.getUTCFullYear()
    const mo = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    const h = String(value.getUTCHours()).padStart(2, '0')
    const mi = String(value.getUTCMinutes()).padStart(2, '0')
    const s = String(value.getUTCSeconds()).padStart(2, '0')
    const ms = String(Math.floor(value.getTime() % 1000)).padStart(3, '0')
    return JSON.stringify(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`)
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
  }
  return 'null'
}
