import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  // VERCEL_URL is automatically injected by Vercel.
  // NEXT_PUBLIC_APP_URL is set via .env.local (local) or Vercel env vars (production).
  // No manual env injection needed in Next.js 15+.
}

// Sentry config wrapper — does nothing if SENTRY_DSN is unset
const sentryConfig = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.SENTRY_DSN, // suppress build-time logs if Sentry not configured
  disableLogger: !process.env.SENTRY_DSN,
})

export default sentryConfig
