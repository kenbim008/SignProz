import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const supabaseAdmin = createAdminClient()

  // Look up token (admin client bypasses RLS — callback is unauthenticated)
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

  // Find or create user
  let userId = tokenData.user_id

  if (!userId) {
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingUsers?.users.find(u => u.email === tokenData.email)

    if (existingUser) {
      userId = existingUser.id
    } else {
      const { data: authData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
        email: tokenData.email,
        email_confirm: true,
      })

      if (signUpError) {
        console.error('User creation error:', signUpError)
        return NextResponse.redirect(new URL('/login?error=creation_failed', request.url))
      }

      userId = authData.user?.id
    }

    if (userId) {
      await supabaseAdmin
        .from('auth_tokens')
        .update({ user_id: userId })
        .eq('token', token)
    }
  }

  if (!userId) {
    return NextResponse.redirect(new URL('/login?error=user_not_found', request.url))
  }

  console.log('[callback] User found:', { userId, email: tokenData.email })

  // Mark token as used
  await supabaseAdmin
    .from('auth_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)

  // Build the redirect response
  const redirectUrl = new URL('/dashboard', request.url)
  const response = NextResponse.redirect(redirectUrl)

  // Set session cookies using cookie header directly
  // These cookies will be set when the browser loads /dashboard
  const sessionData = JSON.stringify({
    access_token: token, // Use the magic link token as a temporary access token
    refresh_token: token,
    expires_at: Date.now() + 3600000,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      email: tokenData.email,
    },
  })

  // Encode for URL safety
  const encodedSession = encodeURIComponent(sessionData)

  console.log('[callback] Setting sb-session cookie, length:', encodedSession.length)

  // Set cookie on redirect response
  response.cookies.set('sb-session', encodedSession, {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  })

  // Also set a flag
  response.cookies.set('auth-success', 'true', {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    maxAge: 60,
    path: '/',
  })

  console.log('[callback] Redirecting to dashboard')
  return response
}