import { createAdminClient } from '@/lib/supabase/admin'
import { isTokenExpired, addAuditLog, isSequentialSigning } from '@/lib/utils'
import { sendMagicLinkEmail, sendCompletionEmail } from '@/lib/email'
import type { SignRequestBody } from '@/lib/types'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: documentId } = await params
    const supabaseAdmin = createAdminClient()

    // 1. Parse body
    const body: SignRequestBody = await request.json()
    const { token, fields } = body

    // 2. Validate token and fields are present
    if (!token || !fields || !Array.isArray(fields)) {
      return Response.json(
        { error: 'Invalid request: token and fields are required' },
        { status: 400 }
      )
    }

    // 3. Look up signer by magic_token AND document_id
    const { data: signer, error: signerError } = await supabaseAdmin
      .from('signers')
      .select('*')
      .eq('magic_token', token)
      .eq('document_id', documentId)
      .single()

    if (signerError || !signer) {
      return Response.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    // 4. Reject if already signed
    if (signer.signed_at) {
      return Response.json({ error: 'Document already signed' }, { status: 409 })
    }

    // 4. Reject if link expired
    if (isTokenExpired(signer.token_expires_at)) {
      return Response.json({ error: 'Signing link has expired' }, { status: 410 })
    }

    // 5. Reject if document status is not 'sent' or 'partially_signed'
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      return Response.json({ error: 'Document not found' }, { status: 404 })
    }

    if (!['sent', 'partially_signed'].includes(document.status)) {
      return Response.json(
        { error: 'Document is not available for signing' },
        { status: 400 }
      )
    }

    // 6. Load and validate fields
    const { data: assignedFields, error: fieldsError } = await supabaseAdmin
      .from('signature_fields')
      .select('*')
      .eq('signer_id', signer.id)

    if (fieldsError) {
      return Response.json({ error: 'Failed to load signature fields' }, { status: 500 })
    }

    // Collect submitted field IDs
    const submittedFieldIds = new Set(fields.map((f: { fieldId: string }) => f.fieldId))

    // Check every required field is submitted
    const missingFields = assignedFields.filter(f => f.is_required && !submittedFieldIds.has(f.id))
    if (missingFields.length > 0) {
      return Response.json({
        error: 'Missing required fields',
        missingFields: missingFields.map(f => f.id),
      }, { status: 400 })
    }

    // Check every submitted field belongs to this signer
    const validFieldIds = new Set(assignedFields.map(f => f.id))
    const invalidFields = fields.filter((f: { fieldId: string }) => !validFieldIds.has(f.fieldId))
    if (invalidFields.length > 0) {
      return Response.json({
        error: 'Invalid fields submitted',
        invalidFields: invalidFields.map(f => f.fieldId),
      }, { status: 400 })
    }

    // Validate field values
    for (const field of fields) {
      if (typeof field.value === 'string' && field.value.startsWith('data:image/')) {
        const sizeInBytes = (field.value.length * 3) / 4
        if (sizeInBytes > 500 * 1024) {
          return Response.json({
            error: `Signature image exceeds 500KB limit (field: ${field.fieldId})`,
          }, { status: 400 })
        }
      }
      if (typeof field.value === 'string' && field.value.trim() === '') {
        return Response.json({
          error: `Field ${field.fieldId} cannot be empty`,
        }, { status: 400 })
      }
    }

    // Check sequential signing order
    const { data: allSignersOrdered } = await supabaseAdmin
      .from('signers')
      .select('*')
      .eq('document_id', documentId)
      .order('order', { ascending: true })

    if (!allSignersOrdered) {
      return Response.json({ error: 'Failed to load signers' }, { status: 500 })
    }

    const hasSequential = allSignersOrdered.some(s => s.order > 0)

    if (hasSequential) {
      const unsignedInOrder = allSignersOrdered.filter(s => !s.signed_at)
      if (unsignedInOrder.length > 0 && unsignedInOrder[0].id !== signer.id) {
        return Response.json({
          error: 'Signing order enforced. Another signer must sign first.',
        }, { status: 403 })
      }
    }

    // 7. Update signature fields with filled values
    for (const field of fields) {
      await supabaseAdmin
        .from('signature_fields')
        .update({ filled_value: field.value })
        .eq('id', field.fieldId)
        .eq('signer_id', signer.id)
    }

    // 8. Build signed_data object and update signer
    const signedData: Record<string, unknown> = {}
    for (const field of fields) {
      signedData[field.fieldId] = field.value
    }

    await supabaseAdmin
      .from('signers')
      .update({
        signed_at: new Date().toISOString(),
        signed_data: signedData,
      })
      .eq('id', signer.id)

    // 9. If signer has not viewed the document, set viewed_at
    if (!signer.viewed_at) {
      await supabaseAdmin
        .from('signers')
        .update({ viewed_at: new Date().toISOString() })
        .eq('id', signer.id)
    }

    // 10. Add audit log
    await addAuditLog(
      supabaseAdmin,
      documentId,
      'signer.signed',
      signer.email,
      { signerId: signer.id }
    )

    // 11. Check all signers status
    const { data: allSigners } = await supabaseAdmin
      .from('signers')
      .select('*')
      .eq('document_id', documentId)

    const allSigned = allSigners?.every((s) => s.signed_at !== null)

    if (allSigned) {
      // Mark document as completed
      await supabaseAdmin
        .from('documents')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', documentId)

      await addAuditLog(
        supabaseAdmin,
        documentId,
        'document.completed',
        signer.email
      )

      // Send completion email to owner
      let ownerEmail = ''
      let ownerName = 'there'

      const { data: owner } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name')
        .eq('id', document.user_id)
        .single()

      if (owner?.email) {
        ownerEmail = owner.email
        ownerName = owner.full_name || 'there'
      } else {
        // Fallback to auth user email if profiles.email is null
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(document.user_id)
        ownerEmail = authUser?.user?.email || ''
        ownerName = (authUser?.user?.user_metadata?.full_name as string) || 'there'
      }

      await sendCompletionEmail({
        documentId,
        documentTitle: document.title,
        ownerEmail,
        ownerName,
        signerCount: allSigners?.length || 0,
        signedAt: new Date().toISOString(),
      })
    } else {
      // Sequential mode: find next pending signer
      const sequential = isSequentialSigning(allSigners || [])

      if (sequential) {
        // Find next signer in order who hasn't signed
        const pendingSigners = (allSigners || [])
          .filter((s) => s.signed_at === null)
          .sort((a, b) => a.order - b.order)

        const nextSigner = pendingSigners[0]

        if (nextSigner) {
          // Fetch owner email for magic link email
          let ownerEmail = ''

          const { data: owner } = await supabaseAdmin
            .from('profiles')
            .select('email')
            .eq('id', document.user_id)
            .single()

          if (owner?.email) {
            ownerEmail = owner.email
          } else {
            // Fallback to auth user email if profiles.email is null
            const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(document.user_id)
            ownerEmail = authUser?.user?.email || ''
          }

          await sendMagicLinkEmail(
            {
              id: nextSigner.id,
              email: nextSigner.email,
              name: nextSigner.name || '',
              magic_token: nextSigner.magic_token,
            },
            {
              id: document.id,
              title: document.title,
              expiration_days: document.expiration_days,
            },
            ownerEmail
          )

          await addAuditLog(
            supabaseAdmin,
            documentId,
            'signer.next_emailed',
            signer.email,
            { nextSignerId: nextSigner.id }
          )
        }
      } else {
        // Parallel mode: just update status to partially_signed
        await supabaseAdmin
          .from('documents')
          .update({ status: 'partially_signed' })
          .eq('id', documentId)
      }
    }

    return Response.json({ success: true, message: 'Signature submitted' })
  } catch (error) {
    console.error('Sign error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
