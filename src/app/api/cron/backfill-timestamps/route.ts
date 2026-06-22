import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EvidenceService } from '@/services'
import { logger } from '@/lib/logger'
import { isAuthorized } from '@/lib/cron'
import { toBuffer } from '@/lib/buffers'

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
      const hash = toBuffer(cert.content_hash_at_completion) ?? Buffer.alloc(0)
      await EvidenceService.requestAndStoreTimestamp(cert.id, hash)
      succeeded++
    } catch (err) {
      failed++
      logger.error('cron.backfill.cert_failed', err, { certificateId: cert.id })
    }
  }
  return NextResponse.json({ ok: true, succeeded, failed })
}
