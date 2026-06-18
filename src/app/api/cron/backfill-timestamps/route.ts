import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { EvidenceService } from '@/services'
import { logger } from '@/lib/logger'

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!auth || !process.env.CRON_SECRET) return false
  const a = Buffer.from(auth)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()

  // Find certs missing tst_token
  const { data: pending } = await supabase
    .from('certificates')
    .select('id, content_hash_at_completion')
    .is('tst_token', null)
    .limit(50)

  let succeeded = 0
  let failed = 0
  for (const cert of pending ?? []) {
    try {
      const hash = cert.content_hash_at_completion instanceof Buffer
        ? cert.content_hash_at_completion
        : Buffer.from(cert.content_hash_at_completion, 'hex')
      await EvidenceService.requestAndStoreTimestamp(cert.id, hash)
      succeeded++
    } catch (err) {
      failed++
      logger.error('cron.backfill.cert_failed', err, { certificateId: cert.id })
    }
  }
  return NextResponse.json({ ok: true, succeeded, failed })
}
