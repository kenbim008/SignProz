import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1, // 10% of transactions
    replaysSessionSampleRate: 0, // disable session replay by default
    replaysOnErrorSampleRate: 1.0, // capture replay on error
    environment: process.env.NODE_ENV,
  })
}
