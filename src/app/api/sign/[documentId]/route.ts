import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ documentId: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { documentId } = await params
    const url = new URL(request.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    // Look up the signer by token
    const { data: signer } = await supabaseAdmin
      .from('signers')
      .select('id, name, signed_at, document_id, token_expires_at')
      .eq('magic_token', token)
      .eq('document_id', documentId)
      .single()

    if (!signer) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    if (signer.signed_at) {
      return NextResponse.json({ state: 'already_signed' })
    }

    // Check if expired
    if (new Date(signer.token_expires_at) < new Date()) {
      return NextResponse.json({ state: 'expired' })
    }

    // Load document (minimal fields)
    const { data: document } = await supabaseAdmin
      .from('documents')
      .select('id, title, content, status')
      .eq('id', documentId)
      .single()

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (document.status === 'completed') {
      return NextResponse.json({ state: 'completed' })
    }

    // Load only this signer's fields (not all fields for the document)
    const { data: fields } = await supabaseAdmin
      .from('signature_fields')
      .select('id, field_type, position_x, position_y, width, height, is_required')
      .eq('signer_id', signer.id)

    // Check if document has sequential ordering
    const { data: allSigners } = await supabaseAdmin
      .from('signers')
      .select('id, signed_at, "order"')
      .eq('document_id', documentId)
      .order('order', { ascending: true })

    const hasSequential = allSigners?.some(s => s.order > 0)
    let state = 'ready'

    if (hasSequential) {
      const unsignedInOrder = allSigners?.filter(s => !s.signed_at)
      if (unsignedInOrder && unsignedInOrder.length > 0 && unsignedInOrder[0].id !== signer.id) {
        state = 'sequential_wait'
      }
    }

    return NextResponse.json({
      state,
      document: {
        id: document.id,
        title: document.title,
        content: document.content,
        status: document.status,
      },
      signer: {
        id: signer.id,
        name: signer.name,
      },
      fields: fields || [],
    })
  } catch (error) {
    logger.error('sign data error', error, { documentId: (await params).documentId })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
