import { NextResponse } from 'next/server'
import { EvidenceService } from '@/services'
import { logger } from '@/lib/logger'
import { isAuthorized } from '@/lib/cron'

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await EvidenceService.appendDailyLogEntry(new Date())
    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error('cron.daily_evidence_log.failed', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
