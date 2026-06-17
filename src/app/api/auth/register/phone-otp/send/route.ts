import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST() {
  try {
    const headersList = await headers()
    const ip = headersList.get('x-forwarded-for') || 'unknown'
    const { allowed, remaining } = rateLimit(`phone-otp:${ip}`, 3, 60000)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } as HeadersInit }
      )
    }

    const cookieStore = await cookies()
    const sessionId = cookieStore.get('reg_session')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'No registration session' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    // Get registration session
    const { data: regSession, error } = await supabaseAdmin
      .from('registration_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (error || !regSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (!regSession.phone) {
      return NextResponse.json({ error: 'No phone number set. Please go back to personal details.' }, { status: 400 })
    }

    // Generate OTP
    const otp = generateOtp()
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes

    // Store OTP in session
    await supabaseAdmin
      .from('registration_sessions')
      .update({
        phone_otp: otp,
        phone_otp_expires_at: otpExpiresAt,
      })
      .eq('id', sessionId)

    logger.info('dev phone otp', { email: regSession.email, phone: regSession.phone, otp })

    return NextResponse.json({
      success: true,
      devOtp: process.env.NODE_ENV === 'development' ? otp : undefined,
    })
  } catch (error) {
    logger.error('send phone otp error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
