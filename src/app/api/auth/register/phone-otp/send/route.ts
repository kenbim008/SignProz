import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST() {
  try {
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

    console.log(`[DEV] Phone OTP for ${regSession.email} (${regSession.phone}): ${otp}`)

    return NextResponse.json({
      success: true,
      devOtp: process.env.NODE_ENV === 'development' ? otp : undefined,
    })
  } catch (error) {
    console.error('Send phone OTP error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
