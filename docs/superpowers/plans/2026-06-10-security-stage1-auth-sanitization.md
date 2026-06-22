# Stage 1 — Security Containment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the critical auth forgery vulnerability (P0) by replacing the unsigned `sb-session` cookie with server-authoritative Supabase session validation, sanitize all stored HTML, remove sensitive logging, and add rate limiting to auth endpoints.

**Architecture:** Replace `getSession()` with `auth.getUser()`-only resolution. The callback route creates a real Supabase session (via temporary password + `signInWithPassword`) instead of stuffing a forged JSON cookie. API routes that previously trusted the custom cookie now fall through to Supabase's verified session. HTML document content is sanitized via DOMPurify on both save and render.

**Tech Stack:** Next.js 16.2.4, Supabase SSR (`@supabase/ssr`), `isomorphic-dompurify`

---

### Task 1.1: Replace `getSession()` with `auth.getUser()` exclusively

**Files:**
- Modify: `src/lib/auth.ts`

- [ ] **Step 1: Rewrite auth.ts**

Remove the custom `sb-session` cookie parsing. Only use Supabase's server-authoritative `getUser()`:

```typescript
import { createServerClient } from '@/lib/supabase/server'

export interface SessionUser {
  id: string
  email: string
}

export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user || !user.email) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors. Some callers reference `.user` and `.isCustomSession` — handle in Tasks 1.2–1.6.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth.ts
git commit -m "fix: replace custom sb-session cookie with auth.getUser()"
```

---

### Task 1.2: Fix callback route to use real Supabase session

**Files:**
- Modify: `src/app/auth/callback/route.ts`

- [ ] **Step 1: Rewrite callback to create a real Supabase session**

After token validation, use a temporary password + `signInWithPassword()` to create a proper SSR-managed session:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/callback/route.ts
git commit -m "fix: create real Supabase session in callback instead of unsigned cookie"
```

---

### Task 1.3: Fix dashboard and session API to use new getSession

**Files:**
- Modify: `src/app/api/auth/session/route.ts`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Rewrite session API route**

Remove all cookie logging and custom `sb-session` parsing:

```typescript
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET() {
  const session = await getSession()

  if (!session) {
    return NextResponse.json({ session: null, user: null })
  }

  return NextResponse.json({
    session: { user: { id: session.id, email: session.email } },
    user: { id: session.id, email: session.email },
  })
}
```

- [ ] **Step 2: Fix dashboard page to work with new session shape**

In `src/app/dashboard/page.tsx`, update the session handling. The dashboard currently expects:
```typescript
interface Session {
  session: { user: { email: string; affiliateCode: string } } | null
}
```

Change the session fetch to use the new shape and get affiliate code from a separate `/api/auth/profile` call or default to empty string:

```typescript
// In the useEffect that fetches session:
fetch('/api/auth/session')
  .then(r => r.json())
  .then(data => {
    if (!data.session) { router.push('/login'); return }
    setSession({
      email: data.session.user.email,
      affiliateCode: data.session.user.affiliateCode || '',
    })
    // ... rest of existing logic
  })
```

Also update the `Session` interface at the top of the file:
```typescript
interface Session {
  email: string
  affiliateCode: string
}
```

And fix the session reference throughout to `session` (not `session.session.user`):
```typescript
// Before: session?.session?.user?.email
// After: session?.email
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/session/route.ts src/app/dashboard/page.tsx
git commit -m "fix: remove session logging, adapt dashboard to new session shape"
```

---

### Task 1.4: Fix register/set-password to not set sb-session cookie

**Files:**
- Modify: `src/app/api/auth/register/set-password/route.ts`

- [ ] **Step 1: Remove sb-session cookie setting**

After setting the password, sign in with the password to create a real Supabase session. Remove the `sb-session` cookie entirely:

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

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
    console.error('Set password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/register/set-password/route.ts
git commit -m "fix: use real Supabase sign-in instead of sb-session cookie"
```

---

### Task 1.5: Fix all API routes that reference `isCustomSession` or old session shape

**Files:**
- Search: all files referencing `isCustomSession`, `session.id`, `session.email`, `getSession()`
- Modify: each file that breaks due to the new session shape

- [ ] **Step 1: Find all impacted files**

Run: `grep -r "isCustomSession\|\.user\b" src/app/api/ --include="*.ts" | grep -v node_modules`

Expected to find files like:
- `src/app/api/documents/route.ts`
- `src/app/api/documents/[id]/route.ts`
- `src/app/api/documents/[id]/send/route.ts`
- `src/app/api/documents/[id]/signers/route.ts`
- `src/app/api/documents/[id]/signers/[signerId]/route.ts`
- `src/app/api/documents/[id]/fields/route.ts`
- `src/app/api/documents/[id]/fields/[fieldId]/route.ts`
- `src/app/api/referrals/route.ts`

- [ ] **Step 2: Fix each file**

The pattern for each API route is:
```typescript
const session = await getSession()
if (!session) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
// Previously: session.id, session.email, session.user
// Now: session.id, session.email (user property removed)
```

Replace all occurrences of `session.user.id` with `session.id`, and `session.user.email` with `session.email`.

If any route was using `session.user` for other properties, update those references.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/
git commit -m "fix: adapt all API routes to new getSession return type"
```

---

### Task 1.6: Sanitize document HTML on save and render

**Files:**
- Modify: `src/app/api/documents/route.ts` (POST — sanitize on save)
- Modify: `src/app/api/sign/[documentId]/route.ts` (GET — sanitize on render)
- Modify: `src/app/sign/[documentId]/page.tsx` (render — sanitize in client)

**Dependencies:** `npm install isomorphic-dompurify`

- [ ] **Step 1: Install DOMPurify**

```bash
npm install isomorphic-dompurify
npx tsc --noEmit
```

- [ ] **Step 2: Sanitize on document save**

In `src/app/api/documents/route.ts` (POST handler), sanitize the content before storing:

```typescript
import DOMPurify from 'isomorphic-dompurify'

// In the POST handler, after extracting body:
const sanitizedContent = body.content ? DOMPurify.sanitize(body.content, {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'span', 'div', 'table', 'thead',
    'tbody', 'tr', 'th', 'td', 'hr', 'a', 'img'],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'target'],
  ALLOW_DATA_ATTR: false,
}) : body.content
```

Store `sanitizedContent` instead of `body.content`.

- [ ] **Step 3: Sanitize on render (in the sign API route)**

In `src/app/api/sign/[documentId]/route.ts`, sanitize content before returning:

```typescript
import DOMPurify from 'isomorphic-dompurify'

// Before returning document data:
if (document.content) {
  document.content = DOMPurify.sanitize(document.content, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'span', 'div', 'hr', 'a', 'img'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'target'],
    ALLOW_DATA_ATTR: false,
  })
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors. (DOMPurify may need type defs: `npm install --save-dev @types/dompurify`)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documents/route.ts src/app/api/sign/\[documentId\]/route.ts package.json
git commit -m "fix: sanitize document HTML with DOMPurify to prevent stored XSS"
```

---

### Task 1.7: Add rate limiting to auth endpoints

**Files:**
- Create: `src/lib/rate-limit.ts`
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/app/api/auth/register/start/route.ts`
- Modify: `src/app/api/auth/register/verify-email/route.ts`
- Modify: `src/app/api/auth/register/phone-otp/send/route.ts`
- Modify: `src/app/api/agreement-analyze/route.ts`
- Modify: `src/app/api/ai/faq/route.ts`

- [ ] **Step 1: Create a simple in-memory rate limiter**

```typescript
// src/lib/rate-limit.ts
const rateMap = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 60000
): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = rateMap.get(key)

  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxAttempts - 1 }
  }

  entry.count++
  if (entry.count > maxAttempts) {
    return { allowed: false, remaining: 0 }
  }

  return { allowed: true, remaining: maxAttempts - entry.count }
}

// Periodic cleanup to prevent memory leak
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateMap) {
      if (now > entry.resetAt) rateMap.delete(key)
    }
  }, 60000)
}
```

- [ ] **Step 2: Add rate limiting to auth endpoints**

Pattern for each route:

```typescript
import { rateLimit } from '@/lib/rate-limit'

// At the start of the handler:
const ip = request.headers.get('x-forwarded-for') || 'unknown'
const { allowed, remaining } = rateLimit(`auth:${ip}`, 5, 60000)

if (!allowed) {
  return Response.json(
    { error: 'Too many attempts. Please try again later.' },
    { status: 429, headers: { 'Retry-After': '60' } }
  )
}
```

Apply to these endpoints:
- `POST /api/auth/login` — key: `login:${ip}`, max 5 per minute
- `POST /api/auth/register/start` — key: `register:${ip}`, max 3 per minute
- `POST /api/auth/register/verify-email` — key: `verify-email:${ip}`, max 10 per minute
- `POST /api/auth/register/phone-otp/send` — key: `phone-otp:${ip}`, max 3 per minute
- `POST /api/agreement-analyze` — key: `ai:${ip}`, max 10 per minute
- `GET /api/ai/faq` — key: `ai:${ip}`, max 20 per minute

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rate-limit.ts src/app/api/auth/login/route.ts src/app/api/auth/register/start/route.ts src/app/api/auth/register/verify-email/route.ts src/app/api/auth/register/phone-otp/send/route.ts src/app/api/agreement-analyze/route.ts src/app/api/ai/faq/route.ts
git commit -m "feat: add rate limiting to auth and AI endpoints"
```

---

### Verification Checklist (Stage 1)

- [ ] `auth.getUser()` is the only source of identity — no custom cookie parsing
- [ ] Callback creates real Supabase session via `signInWithPassword`
- [ ] `sb-session` and `auth-success` cookies are never set
- [ ] No sensitive data logged (no cookie values, no tokens)
- [ ] All API routes use new `getSession()` shape (`session.id`, `session.email`)
- [ ] Document content sanitized with DOMPurify on save and render
- [ ] Rate limiting active on auth and AI endpoints
- [ ] `auth_tokens` rejects already-used tokens (`used_at` check)
- [ ] TypeScript compiles with zero errors
