import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Resend } from 'resend'
import { cookies } from 'next/headers'

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

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
      console.error('Session creation error:', sessionError)
      return NextResponse.json({ error: 'Failed to start registration' }, { status: 500 })
    }

    // Send OTP via Resend
    const resendApiKey = process.env.RESEND_API_KEY
    if (resendApiKey) {
      const resend = new Resend(resendApiKey)
      const { error: emailError } = await resend.emails.send({
        from: 'SignProz <noreply@signproz.com>',
        to: email,
        subject: 'Your SignProz verification code',
        html: `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h1 style="color: #2563eb; font-size: 24px; margin: 0;">Sign<span style="color: #4f46e5;">Proz</span></h1>
  </div>
  <h2 style="color: #0f172a; font-size: 20px; text-align: center;">Your verification code</h2>
  <p style="color: #64748b; text-align: center; font-size: 14px;">
    Enter this code to verify your email address:
  </p>
  <div style="background: #f8fafc; border-radius: 12px; padding: 24px; text-align: center; margin: 16px 0; border: 1px solid #e2e8f0;">
    <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #0f172a; font-family: monospace;">${otp}</span>
  </div>
  <p style="color: #94a3b8; font-size: 12px; text-align: center;">
    This code expires in 10 minutes.
  </p>
</body>
</html>`,
      })

      if (emailError) {
        console.error('Resend error:', emailError)
      }
    } else {
      console.log(`[DEV] Email OTP for ${email}: ${otp}`)
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
