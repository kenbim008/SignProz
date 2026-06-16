# Multi-Step Registration Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace magic-link-only signup with a password-based multi-step registration wizard (email → details → email OTP → phone OTP → password → dashboard).

**Architecture:** Client-side Supabase OTP flows (for proper SSR cookie handling) + server-side registration session CRUD + admin API for final account setup. A `registration_sessions` table persists partial registrations across page refreshes.

**Tech Stack:** Next.js 16.2.4 App Router, Supabase SSR (`@supabase/ssr`), Supabase JS (`@supabase/supabase-js`), Tailwind CSS v4

---

### Task 1: Database Migration (registration_sessions + profiles.phone)

**Files:**
- Create: `supabase/migrations/00003_registration_wizard.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================
-- SignProz Registration Wizard Schema
-- Stores multi-step registration progress
-- =============================================

-- Table: registration_sessions
-- Tracks user progress through the signup wizard.
-- A row is created when the user submits email + terms.
CREATE TABLE IF NOT EXISTS public.registration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  phone TEXT,
  has_verified_email BOOLEAN NOT NULL DEFAULT false,
  has_verified_phone BOOLEAN NOT NULL DEFAULT false,
  referral_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.registration_sessions TO authenticated;
GRANT INSERT ON TABLE public.registration_sessions TO anon;

-- Index for lookups by email (for dedup check)
CREATE INDEX IF NOT EXISTS idx_registration_sessions_email ON public.registration_sessions(email);

-- RLS: authenticated users manage their own session by email
ALTER TABLE public.registration_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registration_sessions_owner_all" ON public.registration_sessions FOR ALL
  TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (email = auth.jwt() ->> 'email');

-- Updated_at trigger (uses existing handle_updated_at function)
CREATE TRIGGER registration_sessions_updated_at
  BEFORE UPDATE ON public.registration_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Add phone column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
GRANT UPDATE (phone) ON TABLE public.profiles TO authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db reset` (if local) or `supabase db push` (if remote)
Expected: Tables created, no errors.

- [ ] **Step 3: Verify migration**

Run: `supabase db diff --linked`
Expected: Shows no pending changes (migration applied).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00003_registration_wizard.sql
git commit -m "feat: add registration_sessions table and profiles.phone column"
```

---

### Task 2: Types — Add RegistrationSession type

**Files:**
- Modify: `src/lib/types.ts` (append before the closing)

- [ ] **Step 1: Add types to src/lib/types.ts**

Append after the `AgreementAnalyzeResponse` interface (before EOF):

```typescript
export interface RegistrationSession {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  has_verified_email: boolean
  has_verified_phone: boolean
  referral_code: string | null
  created_at: string
}

export interface RegistrationStartBody {
  email: string
  referralCode?: string
}

export interface RegistrationSessionBody {
  fullName?: string
  phone?: string
  hasVerifiedEmail?: boolean
  hasVerifiedPhone?: boolean
}

export interface SetPasswordBody {
  password: string
}

export type SignupStep = 'email' | 'details' | 'verify-email' | 'verify-phone-password'
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add RegistrationSession types"
```

---

### Task 3: API Route — POST /api/auth/register/start

**Files:**
- Create: `src/app/api/auth/register/start/route.ts`

- [ ] **Step 1: Create the route**

```typescript
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
```

- [ ] **Step 2: Verify the route**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Test manually**

```bash
curl -X POST http://localhost:3000/api/auth/register/start \
  -H "Content-Type: application/json" \
  -d '{"email":"test-new@example.com"}' \
  -v 2>&1 | head -30
```
Expected: 200 with `{ sessionId }` and `reg_session` cookie set in `Set-Cookie` header. Email sent with 6-digit OTP.

- [ ] **Step 4: Test duplicate user**

```bash
curl -X POST http://localhost:3000/api/auth/register/start \
  -H "Content-Type: application/json" \
  -d '{"email":"existing@example.com"}' \
  -v 2>&1 | head -20
```
Expected: 409 with "already registered" error.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/register/start/route.ts
git commit -m "feat: add POST /api/auth/register/start endpoint"
```

---

### Task 4: API Route — GET + PUT /api/auth/register/session

**Files:**
- Create: `src/app/api/auth/register/session/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get('reg_session')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'No registration session' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()
    const { data: session, error } = await supabaseAdmin
      .from('registration_sessions')
      .select('id, email, full_name, phone, has_verified_email, has_verified_phone, referral_code, created_at')
      .eq('id', sessionId)
      .single()

    if (error || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ session })
  } catch (error) {
    console.error('GET session error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get('reg_session')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'No registration session' }, { status: 401 })
    }

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.fullName !== undefined) updates.full_name = body.fullName
    if (body.phone !== undefined) updates.phone = body.phone
    if (body.hasVerifiedEmail !== undefined) updates.has_verified_email = body.hasVerifiedEmail
    if (body.hasVerifiedPhone !== undefined) updates.has_verified_phone = body.hasVerifiedPhone

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()
    const { data: session, error } = await supabaseAdmin
      .from('registration_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select('id, email, full_name, phone, has_verified_email, has_verified_phone, referral_code, created_at')
      .single()

    if (error || !session) {
      console.error('Session update error:', error)
      return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
    }

    return NextResponse.json({ session })
  } catch (error) {
    console.error('PUT session error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/register/session/route.ts
git commit -m "feat: add GET + PUT /api/auth/register/session endpoints"
```

---

### Task 5: API Route — POST /api/auth/register/set-password

**Files:**
- Create: `src/app/api/auth/register/set-password/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

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

    // Get the authenticated user from Supabase session
    const supabase = await createServerClient()
    const { data: { session: authSession } } = await supabase.auth.getSession()

    if (!authSession?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required. Please verify your email first.' },
        { status: 401 }
      )
    }

    const userId = authSession.user.id

    // Set password via admin API (bypasses need for user session)
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
        // Find the referrer profile by referral code
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
        // Non-fatal — don't block registration
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

    return response
  } catch (error) {
    console.error('Set password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/register/set-password/route.ts
git commit -m "feat: add POST /api/auth/register/set-password endpoint"
```

---

### Task 6: Frontend — Signup Wizard Component

**Files:**
- Create: `src/components/auth/SignupWizard.tsx`
- Modify: `src/app/(auth)/signup/page.tsx`

- [ ] **Step 1: Create the wizard component**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase/browser'
import type { SignupStep, RegistrationSession } from '@/lib/types'

export default function SignupWizard() {
  const router = useRouter()
  const [step, setStep] = useState<SignupStep>('email')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [emailOtpSent, setEmailOtpSent] = useState(false)
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [phoneOtpStep, setPhoneOtpStep] = useState<'send' | 'verify'>('send')

  // Validate email format
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

  // Validate phone format (basic)
  const isValidPhone = (p: string) => /^\+?[\d\s\-()]{7,20}$/.test(p)

  // Check for existing registration session on mount (page refresh recovery)
  useEffect(() => {
    async function restoreSession() {
      const res = await fetch('/api/auth/register/session')
      if (!res.ok) return
      const data = await res.json()
      if (!data.session) return

      const s: RegistrationSession = data.session
      setEmail(s.email)
      setSessionId(s.id)
      if (s.full_name) setFullName(s.full_name)
      if (s.phone) setPhone(s.phone)
      if (s.referral_code) setReferralCode(s.referral_code)
      setEmailOtpSent(true)

      if (s.has_verified_email && s.has_verified_phone) {
        setStep('verify-phone-password')
        setPhoneOtpStep('verify')
        setPhoneOtpSent(true)
      } else if (s.has_verified_email) {
        setStep('verify-phone-password')
        setPhoneOtpStep('send')
      } else if (s.full_name) {
        setStep('verify-email')
      } else {
        setStep('details')
      }
    }
    restoreSession()
  }, [])

  // Step 1: Email + Terms → POST /api/auth/register/start
  const handleStart = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!agreedToTerms) {
      setError('Please agree to the terms and conditions.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, referralCode: referralCode || undefined }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        setLoading(false)
        return
      }

      setSessionId(data.sessionId)
      setEmailOtpSent(true)
      setStep('details')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [email, referralCode, agreedToTerms])

  // Step 2: Personal Details → PUT /api/auth/register/session
  const handleDetails = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!fullName.trim()) {
      setError('Please enter your full name.')
      return
    }
    if (!isValidPhone(phone)) {
      setError('Please enter a valid phone number.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim(), phone }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Something went wrong')
        setLoading(false)
        return
      }

      setStep('verify-email')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [fullName, phone])

  // Step 3: Email OTP verification via Supabase client
  const handleVerifyEmail = useCallback(async (otp: string) => {
    setError('')
    if (otp.length !== 6) {
      setError('Please enter the 6-digit verification code.')
      return
    }

    setLoading(true)

    try {
      const supabase = getBrowserClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'email',
      })

      if (verifyError) {
        setError(verifyError.message === 'Token has expired or is invalid'
          ? 'Code expired or invalid. Request a new one.'
          : verifyError.message)
        setLoading(false)
        return
      }

      // Mark email as verified in session
      const res = await fetch('/api/auth/register/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasVerifiedEmail: true }),
      })

      if (!res.ok) {
        setError('Failed to update session state.')
        setLoading(false)
        return
      }

      setStep('verify-phone-password')
    } catch {
      setError('Verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [email])

  // Step 4a: Phone OTP — Send code via Supabase
  const handleSendPhoneOtp = useCallback(async () => {
    setError('')
    setLoading(true)

    try {
      const supabase = getBrowserClient()
      const { error: updateError } = await supabase.auth.updateUser({ phone })

      if (updateError) {
        setError(updateError.message || 'Failed to send phone code.')
        setLoading(false)
        return
      }

      setPhoneOtpSent(true)
      setPhoneOtpStep('verify')
    } catch {
      setError('Failed to send code. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [phone])

  // Step 4b: Phone OTP — Verify code
  const handleVerifyPhone = useCallback(async (otp: string) => {
    setError('')
    if (otp.length !== 6) {
      setError('Please enter the 6-digit verification code.')
      return
    }

    setLoading(true)

    try {
      const supabase = getBrowserClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: 'phone_change',
      })

      if (verifyError) {
        setError('Invalid code. Please try again.')
        setLoading(false)
        return
      }

      // Mark phone as verified in session
      const res = await fetch('/api/auth/register/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasVerifiedPhone: true }),
      })

      if (!res.ok) {
        setError('Failed to update session state.')
        setLoading(false)
        return
      }

      // Phone verified — now prompt for password
      setPhoneOtpStep('send') // reset for UI repurpose
    } catch {
      setError('Verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [phone])

  // Step 4c: Set Password → POST /api/auth/register/set-password
  const handleSetPassword = useCallback(async (password: string, confirmPassword: string) => {
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to set password.')
        setLoading(false)
        return
      }

      // Registration complete — redirect to dashboard
      router.push('/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [router])

  // Resend email OTP
  const handleResendEmailOtp = useCallback(async () => {
    setError('')
    setLoading(true)

    try {
      const supabase = getBrowserClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      })

      if (otpError) {
        setError(otpError.message || 'Failed to resend code.')
      }
    } catch {
      setError('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }, [email])

  // Use different email (reset to step 1)
  const handleChangeEmail = () => {
    setStep('email')
    setEmailOtpSent(false)
    setError('')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-6">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 w-9 h-9 rounded-xl flex items-center justify-center shadow">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </div>
          <span className="font-bold text-xl tracking-tight"><span className="text-blue-600">Sign</span><span className="text-indigo-600">Proz</span></span>
        </Link>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {['email', 'details', 'verify-email', 'verify-phone-password'].map((s, i) => {
            const stepIndex = ['email', 'details', 'verify-email', 'verify-phone-password'].indexOf(step)
            const isComplete = i < stepIndex
            const isCurrent = i === stepIndex
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  isComplete ? 'bg-green-500 text-white' :
                  isCurrent ? 'bg-blue-600 text-white' :
                  'bg-gray-200 text-gray-400'
                }`}>
                  {isComplete ? '✓' : i + 1}
                </div>
                {i < 3 && <div className={`w-6 h-0.5 ${i < stepIndex ? 'bg-green-500' : 'bg-gray-200'}`} />}
              </div>
            )
          })}
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {/* STEP 1: Email + Terms */}
        {step === 'email' && (
          <form onSubmit={handleStart} className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-900">Create free account</h2>
            <p className="text-gray-500 text-sm">Join SignProz and start sending documents for signature.</p>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="referralCode" className="block text-sm font-medium text-slate-700 mb-1">
                Referral code <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="referralCode"
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                placeholder="e.g. SF-ABCD1234"
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                I agree to the{' '}
                <Link href="/terms" target="_blank" className="text-blue-600 hover:underline">
                  Terms & Conditions
                </Link>
              </span>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending code...' : 'Register'}
            </button>

            <p className="text-center text-sm text-slate-500">
              Already have an account?{' '}
              <Link href="/login" className="text-blue-600 hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}

        {/* STEP 2: Personal Details */}
        {step === 'details' && (
          <form onSubmit={handleDetails} className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-900">Your details</h2>
            <p className="text-gray-500 text-sm">Fill in your personal information to continue.</p>

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-slate-700 mb-1">
                Full name
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                required
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                required
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">Include country code for SMS verification.</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Saving...' : 'Continue'}
            </button>
          </form>
        )}

        {/* STEP 3: Email OTP */}
        {step === 'verify-email' && (
          <EmailOtpStep
            email={email}
            loading={loading}
            onVerify={handleVerifyEmail}
            onResend={handleResendEmailOtp}
            onChangeEmail={handleChangeEmail}
          />
        )}

        {/* STEP 4: Phone OTP + Password */}
        {step === 'verify-phone-password' && (
          <PhonePasswordStep
            phone={phone}
            phoneOtpSent={phoneOtpSent}
            phoneOtpStep={phoneOtpStep}
            loading={loading}
            onSendPhoneOtp={handleSendPhoneOtp}
            onVerifyPhone={handleVerifyPhone}
            onSetPassword={handleSetPassword}
          />
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────

function EmailOtpStep({
  email, loading, onVerify, onResend, onChangeEmail,
}: {
  email: string
  loading: boolean
  onVerify: (otp: string) => Promise<void>
  onResend: () => Promise<void>
  onChangeEmail: () => void
}) {
  const [otp, setOtp] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onVerify(otp)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-900">Verify your email</h2>
      <p className="text-gray-500 text-sm">
        We sent a 6-digit verification code to <strong>{email}</strong>
      </p>

      <div>
        <input
          type="text"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          maxLength={6}
          autoFocus
          className="w-full border border-slate-300 rounded-xl p-3 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <button
        type="submit"
        disabled={loading || otp.length !== 6}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Verifying...' : 'Verify'}
      </button>

      <div className="text-center space-y-2">
        <button
          type="button"
          onClick={onResend}
          disabled={loading}
          className="text-sm text-blue-600 hover:underline disabled:opacity-50"
        >
          Resend Code
        </button>
        <br />
        <button
          type="button"
          onClick={onChangeEmail}
          disabled={loading}
          className="text-sm text-slate-500 hover:underline disabled:opacity-50"
        >
          Use a different email address
        </button>
      </div>
    </form>
  )
}

function PhonePasswordStep({
  phone, phoneOtpSent, phoneOtpStep, loading,
  onSendPhoneOtp, onVerifyPhone, onSetPassword,
}: {
  phone: string
  phoneOtpSent: boolean
  phoneOtpStep: 'send' | 'verify'
  loading: boolean
  onSendPhoneOtp: () => Promise<void>
  onVerifyPhone: (otp: string) => Promise<void>
  onSetPassword: (password: string, confirmPassword: string) => Promise<void>
}) {
  const [phoneOtp, setPhoneOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phoneVerified, setPhoneVerified] = useState(false)

  const handlePhoneVerify = (e: React.FormEvent) => {
    e.preventDefault()
    onVerifyPhone(phoneOtp).then(() => setPhoneVerified(true))
  }

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSetPassword(password, confirmPassword)
  }

  // Phone verification UI (shown first)
  if (!phoneVerified) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Verify your phone</h2>
        <p className="text-gray-500 text-sm">
          We need to verify your phone number: <strong>{phone}</strong>
        </p>

        {phoneOtpStep === 'send' && (
          <button
            type="button"
            onClick={onSendPhoneOtp}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Sending...' : 'Send Code'}
          </button>
        )}

        {phoneOtpStep === 'verify' && (
          <form onSubmit={handlePhoneVerify} className="space-y-4">
            <p className="text-sm text-slate-500">Enter the 6-digit code sent to your phone.</p>
            <input
              type="text"
              value={phoneOtp}
              onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              autoFocus
              className="w-full border border-slate-300 rounded-xl p-3 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={loading || phoneOtp.length !== 6}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Verifying...' : 'Verify Phone'}
            </button>
          </form>
        )}
      </div>
    )
  }

  // Password setup UI (shown after phone verified)
  return (
    <form onSubmit={handlePasswordSubmit} className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-900">Set up password</h2>
      <p className="text-gray-500 text-sm">Create a password for your account.</p>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          required
          minLength={8}
          className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        {password.length > 0 && password.length < 8 && (
          <p className="text-xs text-amber-600 mt-1">Password must be at least 8 characters.</p>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-1">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password"
          required
          className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        {confirmPassword.length > 0 && password !== confirmPassword && (
          <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || password.length < 8 || password !== confirmPassword}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Creating account...' : 'Complete Registration'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Update the signup page to use the wizard**

```typescript
// src/app/(auth)/signup/page.tsx
import SignupWizard from '@/components/auth/SignupWizard'

export default function SignupPage() {
  return <SignupWizard />
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/SignupWizard.tsx src/app/\(auth\)/signup/page.tsx
git commit -m "feat: add multi-step registration wizard with OTP verification"
```

---

### Task 7: Full Integration Test

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: Server starts on http://localhost:3000

- [ ] **Step 2: Open the signup page**

Navigate to: http://localhost:3000/signup
Expected: See the multi-step wizard with email input, terms checkbox, and referral code field.

- [ ] **Step 3: Test validation — submit without terms**

Enter email, leave terms unchecked, click Register.
Expected: Error message "Please agree to the terms and conditions."

- [ ] **Step 4: Test validation — invalid email**

Enter "not-an-email", check terms, click Register.
Expected: Browser's built-in email validation or error message.

- [ ] **Step 5: Test step 1 → step 2**

Enter valid email, check terms, click Register.
Expected: Progress indicator moves to step 2. Email OTP sent (check inbox or console). Personal details form visible.

- [ ] **Step 6: Test step 2 → step 3**

Enter name and phone, click Continue.
Expected: Progress moves to step 3. "Verify your email" message with the email displayed.

- [ ] **Step 7: Test step 3 — email OTP**

Check the email received (or Supabase logs for the OTP `email_otp`), enter the 6-digit code, click Verify.
Expected: Progress moves to step 4 (phone verification). If using Supabase local, check `supabase logs` for the OTP.

- [ ] **Step 8: Test step 4 — phone OTP send**

Click "Send Code" on the phone verification step.
Expected: Supabase attempts to send SMS. (In dev, this may require Supabase's phone auth setup, or use a test phone number.)

- [ ] **Step 9: Test step 4 — phone verification + password setup**

Enter phone OTP (from Supabase logs or test environment), click Verify Phone.
Expected: Password setup form appears.

Enter password (min 8 chars) and confirm, click "Complete Registration".
Expected: Redirected to `/dashboard`. New user exists in Supabase Auth with the password set.

- [ ] **Step 10: Test login with new credentials**

Logout, go to `/login`, enter email + password.
Expected: Successful login, redirected to dashboard.

- [ ] **Step 11: Commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix: registration wizard adjustments after integration test"
```

---

### Verification Checklist

- [ ] User can register with email + terms + personal details + email OTP + phone OTP + password
- [ ] Email OTP is sent and verified via Supabase
- [ ] Phone OTP is sent (if SMS provider configured) and verified via Supabase
- [ ] User is created in Supabase Auth after email verification
- [ ] Password is set and user can log in with email + password
- [ ] Profiles table populated with full_name and phone
- [ ] Referral code is linked (if provided)
- [ ] Registration session is cleaned up after completion
- [ ] Page refresh during registration restores the current step
- [ ] "Use a different email" resets to step 1
- [ ] Existing magic link login still works (/auth/magic-login)
- [ ] Existing users can still login via magic link (/login)
- [ ] Duplicate email registration returns 409
