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
