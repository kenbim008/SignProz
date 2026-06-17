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
 * - Must match PL/pgSQL canonical_audit_json
 */
export function canonicalizeAuditRow(row: Record<string, unknown>): string {
  const { prev_hash, hash, ...data } = row
  return stableStringify(data)
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
  }
  return 'null'
}
