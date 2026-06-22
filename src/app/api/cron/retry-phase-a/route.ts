import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EvidenceService } from '@/services'
import { logger } from '@/lib/logger'
import { isAuthorized } from '@/lib/cron'

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()

  // Find certs whose Phase A blob upload failed (pdf_storage_path IS NULL).
  const { data: pending } = await supabase
    .from('certificates')
    .select('id')
    .is('pdf_storage_path', null)
    .limit(50)

  let succeeded = 0
  let failed = 0
  for (const cert of pending ?? []) {
    try {
      await EvidenceService.retryPhaseA(cert.id)
      succeeded++
    } catch (err) {
      failed++
      logger.error('cron.retry_phase_a.cert_failed', err, { certificateId: cert.id })
    }
  }
  return NextResponse.json({ ok: true, succeeded, failed })
}
