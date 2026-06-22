import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get('reg_session')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'No registration session' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()
    const { data: session, error } = await supabaseAdmin
      .from('registration_sessions')
      .select('id, email, full_name, phone, has_verified_email, has_verified_phone, referral_code, created_at')
      .eq('id', sessionId)
      .single()

    if (error || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ session })
  } catch (error) {
    logger.error('get registration session error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get('reg_session')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'No registration session' }, { status: 401 })
    }

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.fullName !== undefined) updates.full_name = body.fullName
    if (body.phone !== undefined) updates.phone = body.phone
    if (body.hasVerifiedEmail !== undefined) updates.has_verified_email = body.hasVerifiedEmail
    if (body.hasVerifiedPhone !== undefined) updates.has_verified_phone = body.hasVerifiedPhone

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()
    const { data: session, error } = await supabaseAdmin
      .from('registration_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select('id, email, full_name, phone, has_verified_email, has_verified_phone, referral_code, created_at')
      .single()

    if (error || !session) {
      logger.error('registration session update error', error)
      return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
    }

    return NextResponse.json({ session })
  } catch (error) {
    logger.error('put registration session error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
