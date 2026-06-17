# Changelog

All notable changes to SignProz are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security
- **BREAKING**: Replaced custom `sb-session` cookie with Supabase SSR sessions. Magic-link users will need to log in again on next visit.
- HTML content in documents is now sanitized via DOMPurify to prevent stored XSS
- Document signing is now server-enforced (required fields, sequential order)
- Rate limiting added to auth and AI endpoints

### Changed
- Removed false marketing claims about HIPAA, 400+ integrations, Microsoft 365
- Removed mock Stripe payout UI (replaced with "Coming Soon")
- Resolved schema drift: `profiles.email` populated via trigger, field types expanded

## [0.1.0] - 2026-06-16

### Added
- Initial release: multi-step registration wizard (email → details → email OTP → phone OTP → password)
- Magic-link signing with reusable token infrastructure
- Document creation, signer invitations, sequential signing
- Vercel deployment with auto-deploy from `main`
- Supabase-backed auth and data layer
