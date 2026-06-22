import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import * as jose from 'jose'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const supabaseAdmin = createAdminClient()

    // Look up token
    const { data: tokenData, error } = await supabase
      .from('auth_tokens')
      .select('*')
      .eq('token', token)
      .single()

    if (error || !tokenData) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    // Check if expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Expired token' }, { status: 400 })
    }

    // Get user ID
    let userId = tokenData.user_id

    if (!userId) {
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
      const existingUser = existingUsers?.users.find(u => u.email === tokenData.email)

      if (existingUser) {
        userId = existingUser.id
      } else {
        const { data: authData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
          email: tokenData.email,
          email_confirm: true,
        })

        if (signUpError) {
          return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
        }

        userId = authData.user?.id
      }

      if (userId) {
        await supabase
          .from('auth_tokens')
          .update({ user_id: userId })
          .eq('token', token)
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Mark token as used
    await supabase
      .from('auth_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)

    // Create JWT using jose library with the ANON key as signing secret
    // This matches what Supabase expects for access tokens
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const secret = new TextEncoder().encode(anonKey)

    // Create access token JWT
    const jwt = await new jose.SignJWT({
      aud: 'authenticated',
      email: tokenData.email,
      role: 'authenticated',
      aal: 'aal1',
      authenticity: 'high',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('3600s') // 1 hour
      .setIssuer(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`)
      .setJti(crypto.randomUUID())
      .sign(secret)

    // Create refresh token (simpler structure)
    const refreshTokenId = crypto.randomUUID()
    const refreshJwt = await new jose.SignJWT({
      id: refreshTokenId,
      user_id: userId,
      created_at: new Date().toISOString(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('7d')
      .setJti(crypto.randomUUID())
      .sign(secret)

    return NextResponse.json({
      access_token: jwt,
      refresh_token: refreshJwt,
      user: {
        id: userId,
        email: tokenData.email,
      },
    })
  } catch (err) {
    logger.error('magic session error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}