# SignProz — Multi-Step Registration Wizard

**Date:** 2026-06-04
**Status:** Approved Design

---

## Overview

Replace the current single-field magic-link signup with a password-based multi-step registration wizard. New users register with email + password, verify both email and phone via OTP (Supabase), then access the Subscriber Portal (dashboard).

Existing magic link login remains available for current users.

---

## Registration Flow (10 Steps)

| Step | Screen | Action | Backend |
|------|--------|--------|---------|
| 1-2 | Email + Terms | Enter email, check terms checkbox | `POST /api/auth/register/start` → creates `registration_sessions` row + sends Supabase email OTP |
| 3-4 | Personal Details | Full name + phone number | `PUT /api/auth/register/session` → stores in session row |
| 5-7 | Email OTP | Enter 6-digit code, resend, change email | `POST /api/auth/register/verify-email` → verifies OTP, Supabase creates user |
| 8-9 | Phone OTP | Send code, enter 6-digit code | `POST /api/auth/register/send-phone-otp` + `verify-phone` |
| 10 | Set Password | Password + confirm | `POST /api/auth/register/set-password` → sets password, populates profile, redirects to dashboard |

---

## Database

### New Table: `registration_sessions`

```sql
CREATE TABLE public.registration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  phone TEXT,
  has_verified_email BOOLEAN DEFAULT false,
  has_verified_phone BOOLEAN DEFAULT false,
  referral_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_registration_sessions_email ON public.registration_sessions(email);
```

GRANT: `authenticated` users may SELECT/UPDATE/DELETE their own row.  `anon` may INSERT and SELECT (by session cookie). The session row is identified via a `reg_session` cookie.

### Updated Table: `profiles`

Add `phone TEXT` column for storing verified phone number.

```sql
ALTER TABLE public.profiles ADD COLUMN phone TEXT;
```

---

## API Endpoints

### `POST /api/auth/register/start`
- **Body:** `{ email, referralCode?, agreedToTerms }`
- **Validates:** email format, terms accepted, email not already registered
- **Logic:**
  1. Check if user exists in `auth.users` → 409 if so
  2. Upsert `registration_sessions` row for this email
  3. Call `supabase.auth.signInWithOtp({ email })`
  4. Set cookie `reg_session` = session.id
- **Returns:** `{ sessionId }`

### `PUT /api/auth/register/session`
- **Body:** `{ fullName, phone }`
- **Validates:** session cookie present, session not expired
- **Logic:** Update `registration_sessions` with name + phone

### `POST /api/auth/register/verify-email`
- **Body:** `{ otp }`
- **Validates:** session cookie, OTP format
- **Logic:**
  1. Look up session by cookie
  2. `supabase.auth.verifyOtp({ email, token: otp, type: 'email' })`
  3. If success → marks `has_verified_email = true`
- **Returns:** `{ success }`

### `POST /api/auth/register/send-phone-otp`
- **Body:** `{}` (session from cookie)
- **Logic:**
  1. Look up session → get phone
  2. `supabase.auth.signInWithOtp({ phone })`
- **Returns:** `{ success }`

### `POST /api/auth/register/verify-phone`
- **Body:** `{ otp }`
- **Logic:**
  1. `supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' })`
  2. If success → marks `has_verified_phone = true`
- **Returns:** `{ success }`

### `POST /api/auth/register/set-password`
- **Body:** `{ password }`
- **Validates:** password strength (min 8 chars)
- **Logic:**
  1. Look up session
  2. Sign in user (email OTP created them)
  3. `supabase.auth.updateUser({ password })`
  4. Upsert `profiles` row with `full_name`, `phone`
  5. Handle referral if `referral_code` present
  6. Delete `registration_sessions` row
  7. Clear `reg_session` cookie
  8. Create session cookie or Supabase session
- **Returns:** `{ success }` + redirect to `/dashboard`

### `GET /api/auth/register/session`
- **Logic:** Look up session by cookie, return current step data
- **Returns:** `{ email, fullName, phone, hasVerifiedEmail, hasVerifiedPhone }`

---

## Frontend Component

**`/app/(auth)/signup/page.tsx`** (rewritten)

### Wizard Steps

```
SignupWizard
├── Step 0: EmailForm
│   ├── Email input
│   ├── Terms & Conditions checkbox + link to /terms
│   ├── Referral code (optional, hidden field)
│   └── "Register" button
│
├── Step 1: PersonalDetailsForm
│   ├── Full Name input
│   ├── Phone Number input (with country code)
│   └── "Continue" button
│
├── Step 2: EmailOtpForm
│   ├── "We sent a code to {email}"
│   ├── 6-digit OTP input (6 individual boxes)
│   ├── "Resend Code" link
│   ├── "Use a different email address" link
│   └── "Verify" button
│
└── Step 3: PhoneOtpAndPasswordForm
    ├── "Verify your phone: {phone}"
    ├── "Send Code" → reveals OTP input
    ├── 6-digit OTP input
    ├── Password input
    ├── Confirm password input
    └── "Complete Registration" button
```

### State Shape

```typescript
type SignupStep = 'email' | 'details' | 'verify-email' | 'verify-phone-password'

interface SignupState {
  step: SignupStep
  email: string
  fullName: string
  phone: string
  referralCode: string
  sessionId: string
  loading: boolean
  error: string
  phoneOtpSent: boolean
}
```

### Session Persistence

- `reg_session` cookie set after step 1
- On mount, check for `reg_session` cookie → `GET /api/auth/register/session` → restore step
- Cookie cleared on successful completion or explicit "Use a different email"

---

## Error Handling

| Scenario | Step | Response |
|----------|------|----------|
| Email already registered | 1 | "Already registered. Sign in instead." + link to `/login` |
| Terms not checked | 1 | Frontend validation |
| Expired OTP | 3 | "Code expired. Request a new one." |
| Wrong OTP (3x) | 3 | "Too many attempts. New code sent." |
| Invalid phone OTP | 4 | Max 5 attempts, then invalidate |
| Weak password | 4 | Min 8 chars, frontend + backend |
| Network error | Any | Banner + retry |
| Refresh mid-flow | 2-4 | Session cookie restores step |

---

## Security Considerations

1. **OTP is single-use** — Supabase handles this natively
2. **Session cookie** (`reg_session`) is `httpOnly: true`, `secure: true`, `path: /api/auth/register/*`
3. **Password** is never stored in plaintext — Supabase handles hashing
4. **Rate limiting** — Supabase OTP endpoints are inherently rate-limited
5. **Session cleanup** — TTL of 1 hour on `registration_sessions`, cron cleanup or manual
6. **Email OTP → phone OTP session continuity** — After `verifyOtp` for email succeeds, Supabase returns a session. This session is stored in the `registration_session` row and used for subsequent authenticated calls (`send-phone-otp`, `set-password`). The session tokens are relayed via server-side cookies.

---

## What Doesn't Change

- Existing magic link login for current users (`/auth/magic-login`)
- Existing dashboard (`/dashboard`) — no changes needed
- Existing `getSession()` auth helper — continues to work
- Existing document flows, editor, email system
- Existing affiliate program

---

## Migration Steps

1. Run new SQL migration: `registration_sessions` table + `profiles.phone` column
2. Create API routes under `src/app/api/auth/register/`
3. Rewrite `src/app/(auth)/signup/page.tsx` as multi-step wizard
4. Add `phone` field to profile creation in existing auth callback
5. Test full flow locally
