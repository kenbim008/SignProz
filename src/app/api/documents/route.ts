import DOMPurify from 'isomorphic-dompurify'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { addAuditLog } from '@/lib/utils'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createDocumentSchema } from '@/lib/validation'

export async function GET(request: Request) {
  const session = await getSession()

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerClient()
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '20', 10)
  const offset = (page - 1) * limit
  const status = searchParams.get('status')

  let query = supabase
    .from('documents')
    .select('*', { count: 'exact' })
    .eq('user_id', session.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ documents: data, total: count, page, limit })
}

export async function POST(request: Request) {
  const session = await getSession()

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerClient()
  const supabaseAdmin = createAdminClient()
  const parsed = createDocumentSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { title, content, template_id, expiration_days } = parsed.data

  const sanitizedContent = content
    ? DOMPurify.sanitize(content, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'span', 'div',
          'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'a', 'img',
        ],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'target'],
        ALLOW_DATA_ATTR: false,
      })
    : null

  const { data, error } = await supabaseAdmin
    .from('documents')
    .insert({
      user_id: session.id,
      title,
      content: sanitizedContent,
      template_id: template_id || null,
      expiration_days: expiration_days || 7,
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }

  await addAuditLog(supabaseAdmin, data.id, 'document.created', session.email)

  return NextResponse.json({ document: data }, { status: 201 })
}