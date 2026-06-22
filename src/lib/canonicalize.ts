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
 * - Omits prev_hash, hash, and chain_key fields
 * - Floors ISO timestamps to millisecond precision (matching PL/pgSQL
 *   date_trunc('milliseconds', ...) which truncates, not rounds)
 * - Must match PL/pgSQL canonical_audit_json
 */
export function canonicalizeAuditRow(row: Record<string, unknown>): string {
  // Strip chain pointer fields AND the generated `chain_key` column.
  // PL/pgSQL `canonical_audit_json` excludes the same three (prev_hash,
  // hash, chain_key); excluding only the first two here would cause JS
  // and SQL to produce different canonical strings for the same row.
  const { prev_hash, hash, chain_key, ...data } = row
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

/**
 * JSON.stringify with recursively-sorted object keys. Replaces the
 * hand-rolled stringifier: native JSON.stringify is faster, battle-tested,
 * and matches the syntax auditors and PL/pgSQL expect.
 *
 * Audit rows never carry Date instances by the time they reach this
 * function (PostgREST returns timestamps as strings), and the
 * `Number.isFinite` branch from the previous implementation was dead
 * -- no audit row field is a finite number relevant to the hash.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const parts: string[] = []
  for (const k of sortedKeys) {
    parts.push(JSON.stringify(k) + ':' + stableStringify(obj[k]))
  }
  return '{' + parts.join(',') + '}'
}
