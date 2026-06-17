export class TsaError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'TsaError'
  }
}

export interface TsaRequestOptions {
  documentHash: Buffer
  tsaUrl?: string
  maxRetries?: number
  baseDelayMs?: number
}

export const DEFAULT_TSA_URL = 'https://freetsa.org/tsr'

/**
 * Request an RFC 3161 timestamp from a TSA.
 * Returns the raw token bytes (DER-encoded TimeStampResp).
 * Throws TsaError after maxRetries exhausted.
 */
export async function requestTimestamp(opts: TsaRequestOptions): Promise<Buffer> {
  const tsaUrl = opts.tsaUrl ?? DEFAULT_TSA_URL
  const maxRetries = opts.maxRetries ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 1000

  let lastError: unknown = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      await sleep(delay)
    }
    try {
      const res = await fetch(tsaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/timestamp-query' },
        body: buildTimestampRequest(opts.documentHash),
      })
      if (!res.ok) {
        lastError = new TsaError(`TSA returned ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 10 || buf[0] !== 0x30) {
        lastError = new TsaError('TSA response is not a valid DER SEQUENCE')
        continue
      }
      return buf
    } catch (err) {
      lastError = err
    }
  }
  throw new TsaError(`TSA unavailable after ${maxRetries} attempts`, lastError)
}

function buildTimestampRequest(documentHash: Buffer): Buffer {
  // Build a minimal RFC 3161 TimeStampReq:
  //   SEQUENCE {
  //     version         [0] EXPLICIT INTEGER { v1(1) }
  //     messageImprint  [2] EXPLICIT SEQUENCE {
  //       hashAlgorithm   AlgorithmIdentifier SEQUENCE {
  //         algorithm   OID (sha256 = 2.16.840.1.101.3.4.2.1)
  //         parameters  NULL
  //       }
  //       hashedMessage   OCTET STRING
  //     }
  //     certReq         [4] EXPLICIT BOOLEAN DEFAULT FALSE
  //   }
  const parts: Buffer[] = []

  // version INTEGER 1 (tag 0x02, length 0x01, value 0x01)
  const version = Buffer.from([0x02, 0x01, 0x01])

  // hashAlgorithm — SHA-256 OID 2.16.840.1.101.3.4.2.1
  const oidBytes = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01])
  const nullBytes = Buffer.from([0x05, 0x00]) // NULL
  const algorithmId = Buffer.concat([oidBytes, nullBytes])
  const algorithmSeq = Buffer.concat([Buffer.from([0x30, algorithmId.length]), algorithmId])

  // hashedMessage OCTET STRING
  const hashLen = documentHash.length
  const hashOctet = hashLen <= 127
    ? Buffer.concat([Buffer.from([0x04, hashLen]), documentHash])
    : Buffer.concat([Buffer.from([0x04, 0x81, hashLen]), documentHash])

  // messageImprint SEQUENCE
  const miBody = Buffer.concat([algorithmSeq, hashOctet])
  const messageImprint = Buffer.concat([Buffer.from([0x30, miBody.length]), miBody])

  // Assemble into the top-level TimeStampReq
  // Each component is wrapped in an EXPLICIT context-specific tag (A0, A2, A4)
  const reqVersion = wrapExplicit(0, version)
  const reqMessageImprint = wrapExplicit(2, messageImprint)

  // Combine all parts
  const reqBody = Buffer.concat([reqVersion, reqMessageImprint])
  const topSeq = Buffer.concat([Buffer.from([0x30, reqBody.length]), reqBody])
  return topSeq
}

function wrapExplicit(tagNumber: number, inner: Buffer): Buffer {
  const tag = 0xA0 | tagNumber
  if (inner.length <= 127) {
    return Buffer.concat([Buffer.from([tag, inner.length]), inner])
  }
  return Buffer.concat([Buffer.from([tag, 0x81, inner.length]), inner])
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
