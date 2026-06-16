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
