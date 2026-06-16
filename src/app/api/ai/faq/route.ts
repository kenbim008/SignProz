import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

const FALLBACK_ANSWERS: Record<string, string> = {
  pricing:
    "SignProz offers Free, Pro ($10/mo annual or $20/mo), Premium ($39.95/mo annual or $59.95/mo), and Enterprise plans. Annual plans save ~50%. Visit /pricing for full details.",
  integration:
    "SignProz integrates with 400+ tools including Microsoft 365, Salesforce, Slack, Google Workspace, HubSpot, and more via our REST API. Visit /integrations for the full list.",
  security:
    "SignProz is HIPAA-ready with AES-256 encryption, audit trails, and compliance with ESIGN Act and UETA. All documents are encrypted in transit and at rest.",
  affiliate:
    "Earn 20-30% recurring commissions through our affiliate program. Tiers: Bronze (20%), Silver (22%), Gold (25%), Platinum (30%). Visit /affiliate to join.",
  bulk:
    "SignProz supports bulk document sending via CSV upload, API, or our Slack integration. Send to hundreds of recipients in one batch with individual tracking.",
  hipaa:
    "Yes, SignProz supports HIPAA-compliant workflows. Enterprise plans include BAA agreements, audit logs, and dedicated support. Contact sales for details.",
}

const DEFAULT_ANSWER =
  "That's a great question! SignProz is a professional eSignature platform with AI assistance, 400+ integrations, and recurring affiliate rewards. Visit /pricing for plan details or /affiliate to learn about our affiliate program."

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const { allowed, remaining } = rateLimit(`ai:${ip}`, 20, 60000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } as HeadersInit }
    )
  }

  const { searchParams } = new URL(request.url)
  const question = (searchParams.get('question') || '').toLowerCase().trim()

  if (!question) {
    return NextResponse.json({ answer: DEFAULT_ANSWER })
  }

  // Check fallback map first
  for (const [keyword, answer] of Object.entries(FALLBACK_ANSWERS)) {
    if (question.includes(keyword)) {
      return NextResponse.json({ answer })
    }
  }

  // Use Anthropic if API key is available
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-20250514',
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: `You are a SignProz AI assistant. Answer the following question concisely (2-4 sentences). If you don't know, say so.\n\nQuestion: ${question}`,
            },
          ],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const answer = data.content?.[0]?.text
        if (answer) {
          return NextResponse.json({ answer })
        }
      }
    } catch {
      // Fall through to default answer on error
    }
  }

  return NextResponse.json({ answer: DEFAULT_ANSWER })
}
