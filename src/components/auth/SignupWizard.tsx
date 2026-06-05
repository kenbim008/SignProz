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

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
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

  // Step 3: Email OTP verification via custom API
  const handleVerifyEmail = useCallback(async (otp: string) => {
    setError('')
    if (otp.length !== 6) {
      setError('Please enter the 6-digit verification code.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Verification failed.')
        setLoading(false)
        return
      }

      setStep('verify-phone-password')
    } catch {
      setError('Verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

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

      setPhoneOtpStep('send')
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

      router.push('/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [router])

  // Resend email OTP via custom API
  const handleResendEmailOtp = useCallback(async () => {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, referralCode: referralCode || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to resend code.')
      }
    } catch {
      setError('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }, [email, referralCode])

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
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">Email address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>

            <div>
              <label htmlFor="referralCode" className="block text-sm font-medium text-slate-700 mb-1">
                Referral code <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input id="referralCode" type="text" value={referralCode} onChange={(e) => setReferralCode(e.target.value)}
                placeholder="e.g. SF-ABCD1234"
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <span>I agree to the{' '}
                <Link href="/terms" target="_blank" className="text-blue-600 hover:underline">Terms & Conditions</Link>
              </span>
            </label>

            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {loading ? 'Sending code...' : 'Register'}
            </button>

            <p className="text-center text-sm text-slate-500">
              Already have an account?{' '}
              <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
            </p>
          </form>
        )}

        {/* STEP 2: Personal Details */}
        {step === 'details' && (
          <form onSubmit={handleDetails} className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-900">Your details</h2>
            <p className="text-gray-500 text-sm">Fill in your personal information to continue.</p>

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-slate-700 mb-1">Full name</label>
              <input id="fullName" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe" required
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">Phone number</label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 123-4567" required
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              <p className="text-xs text-slate-400 mt-1">Include country code for SMS verification.</p>
            </div>

            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {loading ? 'Saving...' : 'Continue'}
            </button>
          </form>
        )}

        {/* STEP 3: Email OTP */}
        {step === 'verify-email' && (
          <EmailOtpStep
            email={email} loading={loading}
            onVerify={handleVerifyEmail}
            onResend={handleResendEmailOtp}
            onChangeEmail={handleChangeEmail}
          />
        )}

        {/* STEP 4: Phone OTP + Password */}
        {step === 'verify-phone-password' && (
          <PhonePasswordStep
            phone={phone} phoneOtpSent={phoneOtpSent} phoneOtpStep={phoneOtpStep}
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
      <p className="text-gray-500 text-sm">We sent a 6-digit verification code to <strong>{email}</strong></p>

      <div>
        <input type="text" value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000" maxLength={6} autoFocus
          className="w-full border border-slate-300 rounded-xl p-3 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
      </div>

      <button type="submit" disabled={loading || otp.length !== 6}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
        {loading ? 'Verifying...' : 'Verify'}
      </button>

      <div className="text-center space-y-2">
        <button type="button" onClick={onResend} disabled={loading}
          className="text-sm text-blue-600 hover:underline disabled:opacity-50">Resend Code</button>
        <br />
        <button type="button" onClick={onChangeEmail} disabled={loading}
          className="text-sm text-slate-500 hover:underline disabled:opacity-50">Use a different email address</button>
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

  if (!phoneVerified) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Verify your phone</h2>
        <p className="text-gray-500 text-sm">We need to verify your phone number: <strong>{phone}</strong></p>

        {phoneOtpStep === 'send' && (
          <button type="button" onClick={onSendPhoneOtp} disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {loading ? 'Sending...' : 'Send Code'}
          </button>
        )}

        {phoneOtpStep === 'verify' && (
          <form onSubmit={handlePhoneVerify} className="space-y-4">
            <p className="text-sm text-slate-500">Enter the 6-digit code sent to your phone.</p>
            <input type="text" value={phoneOtp}
              onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" maxLength={6} autoFocus
              className="w-full border border-slate-300 rounded-xl p-3 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            <button type="submit" disabled={loading || phoneOtp.length !== 6}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {loading ? 'Verifying...' : 'Verify Phone'}
            </button>
          </form>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handlePasswordSubmit} className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-900">Set up password</h2>
      <p className="text-gray-500 text-sm">Create a password for your account.</p>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters" required minLength={8}
          className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        {password.length > 0 && password.length < 8 && (
          <p className="text-xs text-amber-600 mt-1">Password must be at least 8 characters.</p>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-1">Confirm password</label>
        <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password" required
          className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        {confirmPassword.length > 0 && password !== confirmPassword && (
          <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
        )}
      </div>

      <button type="submit" disabled={loading || password.length < 8 || password !== confirmPassword}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
        {loading ? 'Creating account...' : 'Complete Registration'}
      </button>
    </form>
  )
}
