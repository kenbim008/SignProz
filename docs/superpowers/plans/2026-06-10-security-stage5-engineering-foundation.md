# Stage 5 — Engineering Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish automated testing, replace boilerplate README with operational docs, remove sensitive logging, add structured error handling, and set up CI.

**Architecture:** Vitest for unit tests, a test suite for auth/validation logic, Playwright for E2E flows (optional setup), and a validation layer using Zod for API request schemas.

**Tech Stack:** Vitest, Zod, Playwright (optional), GitHub Actions

---

### Task 5.1: Set up testing infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/__tests__/auth.test.ts`
- Create: `src/lib/__tests__/rate-limit.test.ts`
- Create: `src/lib/__tests__/utils.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 3: Add test script to package.json**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Write tests for rate limiter**

```typescript
// src/lib/__tests__/rate-limit.test.ts
import { describe, it, expect } from 'vitest'
import { rateLimit } from '../rate-limit'

describe('rateLimit', () => {
  it('allows first request', () => {
    const result = rateLimit('test-key', 5, 60000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks after exceeding max attempts', () => {
    const key = `block-key-${Date.now()}`
    for (let i = 0; i < 5; i++) {
      rateLimit(key, 5, 60000)
    }
    const result = rateLimit(key, 5, 60000)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('resets after window expires', () => {
    const key = `reset-key-${Date.now()}`
    rateLimit(key, 1, 10) // 10ms window
    rateLimit(key, 1, 10) // blocked

    // Wait for window to expire
    return new Promise((resolve) => {
      setTimeout(() => {
        const result = rateLimit(key, 1, 10)
        expect(result.allowed).toBe(true)
        resolve(result)
      }, 20)
    })
  })
})
```

- [ ] **Step 5: Write tests for auth utilities**

```typescript
// src/lib/__tests__/utils.test.ts
import { describe, it, expect } from 'vitest'
import { isTokenExpired, isSequentialSigning } from '@/lib/utils'

describe('isTokenExpired', () => {
  it('returns true for past dates', () => {
    const past = new Date(Date.now() - 10000).toISOString()
    expect(isTokenExpired(past)).toBe(true)
  })

  it('returns false for future dates', () => {
    const future = new Date(Date.now() + 10000).toISOString()
    expect(isTokenExpired(future)).toBe(false)
  })
})

describe('isSequentialSigning', () => {
  it('returns false when all signers have order 0', () => {
    const signers = [
      { id: '1', order: 0 },
      { id: '2', order: 0 },
    ]
    expect(isSequentialSigning(signers as any)).toBe(false)
  })

  it('returns true when any signer has order > 0', () => {
    const signers = [
      { id: '1', order: 0 },
      { id: '2', order: 1 },
    ]
    expect(isSequentialSigning(signers as any)).toBe(true)
  })
})
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package.json src/lib/__tests__/
git commit -m "feat: add test infrastructure with Vitest and initial test suite"
```

---

### Task 5.2: Remove sensitive logging

**Files:**
- Modify: `src/app/api/auth/session/route.ts`
- Modify: `src/app/auth/callback/route.ts`

- [ ] **Step 1: Audit and remove logs that expose secrets**

In `src/app/api/auth/session/route.ts` — the file was already cleaned in Stage 1, but verify no tokens or cookie values are logged.

In `src/app/auth/callback/route.ts` — remove:
```typescript
console.log('[callback] User found:', { userId, email: tokenData.email })
console.log('[callback] Setting sb-session cookie, length:', encodedSession.length)
console.log('[callback] Redirecting to dashboard')
```

Replace with nothing, or a single generic log:
```typescript
console.log('[callback] Magic link login success')
```

- [ ] **Step 2: Commit**

```bash
git add src/app/auth/callback/route.ts
git commit -m "fix: remove sensitive data from authentication logs"
```

---

### Task 5.3: Add request validation with Zod

**Files:**
- Create: `src/lib/validation.ts`
- Modify: `src/app/api/auth/register/start/route.ts`
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/app/api/documents/route.ts`

- [ ] **Step 1: Install Zod**

```bash
npm install zod
```

- [ ] **Step 2: Create validation schemas**

```typescript
// src/lib/validation.ts
import { z } from 'zod'

export const emailSchema = z.string().email('Invalid email address')

export const registerStartSchema = z.object({
  email: emailSchema,
  referralCode: z.string().optional(),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).optional(),
})

export const createDocumentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  content: z.string().optional(),
  template_id: z.string().optional(),
  expiration_days: z.number().int().min(1).max(365).optional().default(7),
})

export const otpSchema = z.object({
  otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/),
})

export const setPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
```

- [ ] **Step 3: Use validation in routes**

Pattern for each route:
```typescript
import { registerStartSchema } from '@/lib/validation'

// At the start of the handler:
const parsed = registerStartSchema.safeParse(await request.json())
if (!parsed.success) {
  return Response.json({
    error: parsed.error.errors[0].message,
  }, { status: 400 })
}
const { email, referralCode } = parsed.data
```

Apply to: register/start, login, verify-email, set-password, document creation.

- [ ] **Step 4: Verify TypeScript compiles and tests pass**

```bash
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/app/api/auth/register/start/route.ts src/app/api/auth/login/route.ts src/app/api/documents/route.ts
git commit -m "feat: add Zod request validation for API routes"
```

---

### Task 5.4: Replace boilerplate README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write a proper README**

```markdown
# SignProz — Smart eSignature Platform

SignProz is an electronic signature and document workflow platform built with Next.js and Supabase.

## Architecture

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend:** Next.js API Routes (server-side)
- **Database:** Supabase PostgreSQL with Row-Level Security
- **Auth:** Supabase Auth (email OTP / password)
- **Email:** Resend (production) / Nodemailer (development)
- **AI:** Anthropic SDK (agreement analysis, FAQ)

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for local Supabase)
- A Supabase project (local or cloud)

### Environment Variables

Copy `.env.local.example` to `.env.local`:

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `RESEND_API_KEY` | No | Resend API key for email |
| `ANTHROPIC_API_KEY` | No | For AI features |
| `NEXT_PUBLIC_APP_URL` | Yes | Application base URL |

### Database Setup

```bash
# Apply migrations (uses supabase CLI)
supabase link --project-ref <your-project>
supabase db push
```

### Run Development Server

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Testing

```bash
npm test        # Run unit tests
npm run test:watch  # Watch mode
```

## Project Structure

```
src/
├── app/
│   ├── (auth)/       # Login, signup pages
│   ├── (site)/       # Marketing pages
│   ├── api/          # Route handlers
│   │   └── auth/     # Auth endpoints
│   │   └── documents/# Document CRUD + signing
│   ├── auth/         # Auth callback, OTP verify
│   ├── dashboard/    # Main app
│   └── sign/         # Public signing ceremony
├── components/
│   ├── auth/         # Signup wizard
│   └── modals/       # AI modals, signature modal
└── lib/
    ├── supabase/     # Client configs
    ├── email/        # Email templates
    ├── auth.ts       # Session helper
    ├── types.ts      # TypeScript types
    ├── utils.ts      # Utility functions
    ├── validation.ts # Zod schemas
    └── rate-limit.ts # Rate limiter
```

## Deployment

```bash
vercel deploy --prod
```

Set all environment variables in Vercel project settings before deploying.

## Security

- Authentication uses Supabase SSR with server-authoritative `auth.getUser()`
- Document content is sanitized with DOMPurify to prevent XSS
- Rate limiting on auth and AI endpoints
- Signing tokens are unique and expire after 7 days
- Sequential signing enforced server-side
- Audit logs are append-only (DELETE blocked at DB level)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: replace boilerplate README with operational documentation"
```

---

### Task 5.5: Set up CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
name: CI
on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run build
      - run: npm test
      - run: npx eslint .
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat: add CI workflow for type-check, build, test, lint"
```

---

### Verification Checklist (Stage 5)

- [ ] `npm test` runs Vitest and all tests pass
- [ ] Rate limiter tests verify allow/block/reset behavior
- [ ] Auth utility tests verify expiry and sequential detection
- [ ] No sensitive data logged (tokens, sessions, cookies)
- [ ] Zod validation active on register start, login, document creation
- [ ] README documents architecture, setup, env vars, deployment, security
- [ ] CI runs type-check, build, test, lint on push
