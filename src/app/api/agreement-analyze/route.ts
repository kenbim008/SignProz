import { Anthropic } from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

const SYSTEM_PROMPT = `You are a legal document analyst. Analyze the provided document text and return a structured JSON response. Always return valid JSON matching the exact schema. Focus on: key obligations, deadlines, parties involved, risky clauses (indemnification, liability caps, auto-renewal, termination traps), and recommended actions for a signer.`

function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const { allowed, remaining } = rateLimit(`ai:${ip}`, 10, 60000)
  if (!allowed) {
    return Response.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  const { content } = await request.json()

  if (!content || typeof content !== 'string') {
    return Response.json({ error: 'content is required' }, { status: 400 })
  }

  const truncated = content.slice(0, 10000)

  const anthropic = getAnthropic()

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: truncated,
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

  try {
    const parsed = JSON.parse(responseText)
    return NextResponse.json(parsed)
  } catch {
    return NextResponse.json({
      summary: responseText.slice(0, 300),
      keyTerms: [],
      riskFlags: [],
      recommendedActions: [],
    })
  }
}
