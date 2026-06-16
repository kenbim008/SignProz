import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Resend } from 'resend'
import { cookies } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'
import { registerStartSchema } from '@/lib/validation'

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const { allowed, remaining } = rateLimit(`register:${ip}`, 3, 60000)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } as HeadersInit }
      )
    }

    const parsed = registerStartSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { email, referralCode } = parsed.data

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

    // Also clean up any stale session for this email (in case cookie was lost)
    await supabaseAdmin
      .from('registration_sessions')
      .delete()
      .eq('email', email)

    // Generate OTP
    const otp = generateOtp()
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes

    // Create registration session with OTP
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('registration_sessions')
      .insert({
        email,
        referral_code: referralCode || null,
        email_otp: otp,
        email_otp_expires_at: otpExpiresAt,
      })
      .select('id, email')
      .single()

    if (sessionError || !session) {
      console.error('Session creation error:', JSON.stringify(sessionError))
      return NextResponse.json({ error: 'Failed to start registration' }, { status: 500 })
    }

    // Always log OTP for debugging (visible in dev server logs)
    console.log(`[DEV] Registration OTP for ${email}: ${otp}`)

    // Send OTP via Resend (non-blocking — don't fail registration if email fails)
    const resendApiKey = process.env.RESEND_API_KEY
    if (resendApiKey) {
      const resend = new Resend(resendApiKey)
      resend.emails.send({
        from: 'SignProz <onboarding@resend.dev>',
        to: email,
        subject: 'Your SignProz verification code',
        html: `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h1 style="color: #2563eb; font-size: 24px; margin: 0;">Sign<span style="color: #4f46e5;">Proz</span></h1>
  </div>
  <h2 style="color: #0f172a; font-size: 20px; text-align: center;">Your verification code</h2>
  <div style="background: #f8fafc; border-radius: 12px; padding: 24px; text-align: center; margin: 16px 0; border: 1px solid #e2e8f0;">
    <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #0f172a; font-family: monospace;">${otp}</span>
  </div>
  <p style="color: #94a3b8; font-size: 12px; text-align: center;">This code expires in 10 minutes.</p>
</body>
</html>`,
      }).catch((e: unknown) => console.error('Resend error (non-blocking):', e))
    }

    // Set registration session cookie
    const response = NextResponse.json({
      sessionId: session.id,
      devOtp: process.env.NODE_ENV === 'development' ? otp : undefined,
    })

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
