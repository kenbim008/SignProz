import { createHash } from 'node:crypto'

/**
 * Compute a SHA-256 Merkle root from a list of 32-byte leaf hashes.
 * - Empty list returns empty buffer.
 * - Single leaf returns it unchanged (the leaf is itself a hash).
 * - Pairwise: hash(left || right) to produce the parent.
 * - Odd level: the last node is promoted unchanged to the next level.
 *   This matches the PL/pgSQL merkle_root_for_document convention
 *   so JS and PL/pgSQL produce the same root for the same audit chain.
 *
 * IMPORTANT: the caller MUST pre-hash the leaves. This function does
 * not hash the input.
 */
export function merkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return Buffer.alloc(0)
  if (leaves.length === 1) return leaves[0]

  let level = leaves.slice()
  while (level.length > 1) {
    const next: Buffer[] = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i])
      } else {
        next.push(sha256Pair(level[i], level[i + 1]))
      }
    }
    level = next
  }
  return level[0]
}

function sha256Pair(left: Buffer, right: Buffer): Buffer {
  const h = createHash('sha256')
  h.update(left)
  h.update(right)
  return h.digest()
}
