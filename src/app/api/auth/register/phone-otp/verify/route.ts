import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const { otp } = await request.json()

    if (!otp || otp.length !== 6) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const sessionId = cookieStore.get('reg_session')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'No registration session' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    const { data: regSession, error } = await supabaseAdmin
      .from('registration_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (error || !regSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Check if OTP exists
    if (!regSession.phone_otp) {
      return NextResponse.json({ error: 'No verification code sent. Send a new code.' }, { status: 400 })
    }

    // Check if OTP is expired
    if (new Date(regSession.phone_otp_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Code expired. Send a new code.' }, { status: 410 })
    }

    // Verify OTP
    if (regSession.phone_otp !== otp) {
      return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 })
    }

    // Mark phone as verified and clear OTP
    await supabaseAdmin
      .from('registration_sessions')
      .update({
        has_verified_phone: true,
        phone_otp: null,
        phone_otp_expires_at: null,
      })
      .eq('id', sessionId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Verify phone OTP error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
