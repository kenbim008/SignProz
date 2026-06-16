import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const supabaseAdmin = createAdminClient()

  // Look up token
  const { data: tokenData, error } = await supabaseAdmin
    .from('auth_tokens')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !tokenData) {
    return NextResponse.redirect(new URL('/login?error=invalid_token', request.url))
  }

  // Check if expired
  if (new Date(tokenData.expires_at) < new Date()) {
    return NextResponse.redirect(new URL('/login?error=expired_token', request.url))
  }

  // Check if already used
  if (tokenData.used_at) {
    return NextResponse.redirect(new URL('/login?error=token_already_used', request.url))
  }

  // Find or create user
  let userId = tokenData.user_id

  if (!userId) {
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingUsers?.users.find(u => u.email === tokenData.email)

    if (existingUser) {
      userId = existingUser.id
    } else {
      const { data: authData } = await supabaseAdmin.auth.admin.createUser({
        email: tokenData.email,
        email_confirm: true,
      })
      userId = authData.user?.id
    }

    if (userId) {
      await supabaseAdmin.from('auth_tokens').update({ user_id: userId }).eq('token', token)
    }
  }

  if (!userId) {
    return NextResponse.redirect(new URL('/login?error=user_not_found', request.url))
  }

  // Mark token as used
  await supabaseAdmin.from('auth_tokens').update({ used_at: new Date().toISOString() }).eq('token', token)

  // Create a REAL Supabase session by setting a temp password and signing in
  const tempPassword = crypto.randomUUID() + crypto.randomUUID()
  await supabaseAdmin.auth.admin.updateUserById(userId, { password: tempPassword })

  const supabase = await createServerClient()
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: tokenData.email,
    password: tempPassword,
  })

  if (signInError) {
    console.error('Session creation failed:', signInError.message)
    return NextResponse.redirect(new URL('/login?error=session_failed', request.url))
  }

  const redirectUrl = new URL('/dashboard', request.url)
  const response = NextResponse.redirect(redirectUrl)
  return response
}
