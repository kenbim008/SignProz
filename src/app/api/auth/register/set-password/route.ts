import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  try {
    const { password } = await request.json()

    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const cookieStore = await cookies()
    const sessionId = cookieStore.get('reg_session')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'No registration session' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    const { data: regSession } = await supabaseAdmin
      .from('registration_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (!regSession) {
      return NextResponse.json({ error: 'Registration session not found' }, { status: 404 })
    }

    if (!regSession.has_verified_email) {
      return NextResponse.json({ error: 'Email not verified' }, { status: 400 })
    }
    if (!regSession.has_verified_phone) {
      return NextResponse.json({ error: 'Phone not verified' }, { status: 400 })
    }

    const { data: users } = await supabaseAdmin.auth.admin.listUsers()
    const authUser = users?.users.find(u => u.email === regSession.email)

    if (!authUser?.id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const userId = authUser.id

    // Set password via admin API
    await supabaseAdmin.auth.admin.updateUserById(userId, { password })

    // Update profile
    await supabaseAdmin
      .from('profiles')
      .update({
        full_name: regSession.full_name || regSession.email.split('@')[0],
        ...(regSession.phone ? { phone: regSession.phone } : {}),
      })
      .eq('id', userId)

    // Handle referral code
    if (regSession.referral_code) {
      const { data: referrer } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('referral_code', regSession.referral_code)
        .single()

      if (referrer) {
        await supabaseAdmin.from('affiliate_referrals').insert({
          referrer_id: referrer.id,
          referred_email: regSession.email,
          status: 'registered',
        })
      }
    }

    // Clean up registration session
    await supabaseAdmin.from('registration_sessions').delete().eq('id', sessionId)

    // Sign in to create real Supabase session
    const supabase = await createServerClient()
    await supabase.auth.signInWithPassword({
      email: regSession.email,
      password,
    })

    const response = NextResponse.json({ success: true })

    response.cookies.set('reg_session', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })

    return response
  } catch (error) {
    logger.error('set password error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
