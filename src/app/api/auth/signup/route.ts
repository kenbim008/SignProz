import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendAuthMagicLinkEmail } from '@/lib/email/sendAuthMagicLink'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  try {
    const { email, referralCode } = await request.json()

    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 })
    }

    const supabase = await createServerClient()

    // Generate a magic token
    const magicToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

    // Store token in auth_tokens table
    const { error: tokenError } = await supabase
      .from('auth_tokens')
      .insert({
        token: magicToken,
        email,
        type: 'signup',
        expires_at: expiresAt,
      })

    if (tokenError) {
      logger.error('token storage error', tokenError, { email })
      return Response.json({ error: 'Failed to create magic link' }, { status: 500 })
    }

    // Build magic URL pointing to our callback with the token
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://sign-proz-bay.vercel.app'
    const magicUrl = `${appUrl}/auth/callback?token=${magicToken}`

    // Send magic link via Resend
    await sendAuthMagicLinkEmail(email, magicUrl, 'signup')

    return NextResponse.json({
      message: 'Check your email for the signup link.',
    })
  } catch (error) {
    logger.error('signup error', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
