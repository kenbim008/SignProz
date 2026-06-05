import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const { email, referralCode } = await request.json()

    // Validation
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }

    // Check if user already exists
    const supabaseAdmin = createAdminClient()
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingUsers?.users.find(u => u.email === email)
    if (existingUser) {
      return NextResponse.json(
        { error: 'This email is already registered. Try signing in instead.' },
        { status: 409 }
      )
    }

    // Check if there's an existing registration session and clean it up
    const cookieStore = await cookies()
    const existingSessionId = cookieStore.get('reg_session')?.value
    if (existingSessionId) {
      await supabaseAdmin
        .from('registration_sessions')
        .delete()
        .eq('id', existingSessionId)
    }

    // Create registration session
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('registration_sessions')
      .insert({
        email,
        referral_code: referralCode || null,
      })
      .select('id, email')
      .single()

    if (sessionError || !session) {
      console.error('Session creation error:', sessionError)
      return NextResponse.json({ error: 'Failed to start registration' }, { status: 500 })
    }

    // Send email OTP via Supabase
    const supabase = await createServerClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })

    if (otpError) {
      // Clean up session if OTP send fails
      await supabaseAdmin.from('registration_sessions').delete().eq('id', session.id)
      console.error('OTP send error:', otpError)
      return NextResponse.json({ error: 'Failed to send verification code' }, { status: 500 })
    }

    // Set registration session cookie
    const response = NextResponse.json({ sessionId: session.id })

    response.cookies.set('reg_session', session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600, // 1 hour
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Register start error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
