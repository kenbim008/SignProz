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
    const { data: session, error } = await supabaseAdmin
      .from('registration_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (error || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Check if OTP exists
    if (!session.email_otp) {
      return NextResponse.json({ error: 'No verification code sent. Please start again.' }, { status: 400 })
    }

    // Check if OTP is expired
    if (new Date(session.email_otp_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 410 })
    }

    // Verify OTP
    if (session.email_otp !== otp) {
      return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 })
    }

    // Check if user already exists (paranoid check)
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingUsers?.users.find((u: { email?: string }) => u.email === session.email)
    if (existingUser) {
      return NextResponse.json(
        { error: 'This email is already registered. Try signing in instead.' },
        { status: 409 }
      )
    }

    // Create the Supabase auth user (email confirmed, no password yet)
    const { data: authData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
      email: session.email,
      email_confirm: true,
      user_metadata: { full_name: session.full_name || '' },
    })

    if (signUpError || !authData.user) {
      console.error('User creation error:', signUpError)
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    // Mark email as verified in session
    await supabaseAdmin
      .from('registration_sessions')
      .update({
        has_verified_email: true,
        email_otp: null, // Clear used OTP
        email_otp_expires_at: null,
      })
      .eq('id', sessionId)

    return NextResponse.json({ success: true, userId: authData.user.id })
  } catch (error) {
    console.error('Verify email error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
