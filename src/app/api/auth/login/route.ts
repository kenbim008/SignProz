import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendAuthMagicLinkEmail } from '@/lib/email/sendAuthMagicLink'

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()

    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 })
    }

    // If password provided, use password-based login
    if (password) {
      const supabase = await createServerClient()
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        console.error('Password login error:', error)
        return Response.json({ error: 'Invalid email or password' }, { status: 401 })
      }

      // Set session cookie for the custom auth flow
      const sessionData = JSON.stringify({
        access_token: data.session?.access_token || '',
        refresh_token: data.session?.refresh_token || '',
        expires_at: Date.now() + 3600000,
        user: {
          id: data.user?.id,
          email: data.user?.email,
        },
      })
      const encodedSession = encodeURIComponent(sessionData)
      const response = NextResponse.json({ user: data.user })
      response.cookies.set('sb-session', encodedSession, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 3600,
        path: '/',
      })
      return response
    }

    // Otherwise send magic link (existing flow)
    const supabase = await createServerClient()

    // Generate a magic token
    const magicToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    // Store token in auth_tokens table (use admin client to bypass RLS)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabaseAdmin = createAdminClient()
    const { error: tokenError } = await supabaseAdmin
      .from('auth_tokens')
      .insert({
        token: magicToken,
        email,
        type: 'login',
        expires_at: expiresAt,
      })

    if (tokenError) {
      console.error('Token storage error:', tokenError)
      return Response.json({ error: 'Failed to create magic link' }, { status: 500 })
    }

    // Build magic URL pointing to our callback with the token
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://sign-proz-bay.vercel.app'
    const magicUrl = `${appUrl}/auth/callback?token=${magicToken}`

    // Send magic link via Resend
    await sendAuthMagicLinkEmail(email, magicUrl, 'login')

    return NextResponse.json({
      message: 'Check your email for the sign in link.',
    })
  } catch (error) {
    console.error('Login error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
