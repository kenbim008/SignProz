import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const { password } = await request.json()

    // Validate password
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    // Get registration session
    const cookieStore = await cookies()
    const sessionId = cookieStore.get('reg_session')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'No registration session' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    const { data: regSession, error: sessionError } = await supabaseAdmin
      .from('registration_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !regSession) {
      return NextResponse.json({ error: 'Registration session not found' }, { status: 404 })
    }

    // Verify email and phone were verified
    if (!regSession.has_verified_email) {
      return NextResponse.json({ error: 'Email not verified' }, { status: 400 })
    }
    if (!regSession.has_verified_phone) {
      return NextResponse.json({ error: 'Phone not verified' }, { status: 400 })
    }

    // Find the user by email (created during email verification via admin API)
    const { data: users } = await supabaseAdmin.auth.admin.listUsers()
    const authUser = users?.users.find((u: { email?: string }) => u.email === regSession.email)

    if (!authUser?.id) {
      return NextResponse.json(
        { error: 'User not found. Please complete email verification first.' },
        { status: 404 }
      )
    }

    const userId = authUser.id

    // Set password via admin API
    const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password }
    )

    if (passwordError) {
      console.error('Password set error:', passwordError)
      return NextResponse.json({ error: 'Failed to set password' }, { status: 500 })
    }

    // Populate profile
    const profileUpdate: Record<string, unknown> = {
      full_name: regSession.full_name || regSession.email.split('@')[0],
    }
    if (regSession.phone) {
      profileUpdate.phone = regSession.phone
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', userId)

    if (profileError) {
      console.error('Profile update error:', profileError)
    }

    // Handle referral code if present
    if (regSession.referral_code) {
      try {
        const { data: referrer } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('referral_code', regSession.referral_code)
          .single()

        if (referrer) {
          await supabaseAdmin
            .from('affiliate_referrals')
            .insert({
              referrer_id: referrer.id,
              referred_email: regSession.email,
              status: 'registered',
            })
        }
      } catch (refError) {
        console.error('Referral processing error:', refError)
      }
    }

    // Clean up registration session
    await supabaseAdmin
      .from('registration_sessions')
      .delete()
      .eq('id', sessionId)

    // Clear reg_session cookie
    const response = NextResponse.json({ success: true })

    response.cookies.set('reg_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })

    // Set session cookie so user is auto-logged in
    const sessionData = JSON.stringify({
      access_token: '',
      refresh_token: '',
      expires_at: Date.now() + 3600000,
      expires_in: 3600,
      token_type: 'bearer',
      user: {
        id: userId,
        email: regSession.email,
      },
    })
    const encodedSession = encodeURIComponent(sessionData)
    response.cookies.set('sb-session', encodedSession, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Set password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
