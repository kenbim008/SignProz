import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
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
