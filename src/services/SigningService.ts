/**
 * SigningService — the document signing workflow.
 *
 * The atomic sign operation is delegated to the PL/pgSQL `sign_document()`
 * function (migration 00007). Service methods map PG exception codes to
 * ServiceError codes for the route layer.
 *
 * Side effects on successful sign:
 *   - If document completes, send completion email to owner
 *   - If sequential mode and not yet complete, email the next pending signer
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { ServiceError } from '@/services/errors'
import { addAuditLog } from '@/lib/utils'

export interface SigningContext {
  document: {
    id: string
    title: string
    status: string
    content: string | null
    signers: Array<{
      id: string
      email: string
      name: string | null
      order: number
      signed_at: string | null
    }>
  }
  signer: {
    id: string
    email: string
    name: string | null
    signed_at: string | null
  }
  fields: Array<{
    id: string
    field_type: string
    position_x: number
    position_y: number
    width: number
    height: number
    is_required: boolean
    signer_id: string | null
  }>
}

export interface SignResult {
  success: boolean
  documentStatus: 'completed' | 'partially_signed'
  signerId: string
}

// Map PG SQLSTATE + message to ServiceError codes
function mapPgErrorToServiceError(message: string, code: string): ServiceError {
  const upper = message.toUpperCase()
  if (upper === 'INVALID_TOKEN' || code === '28000') {
    return new ServiceError('UNAUTHORIZED', 'Invalid or expired token')
  }
  if (upper === 'TOKEN_EXPIRED') {
    return new ServiceError('TOKEN_EXPIRED', 'Signing link has expired')
  }
  if (upper === 'ALREADY_SIGNED') {
    return new ServiceError('CONFLICT', 'Document already signed')
  }
  if (upper === 'INVALID_STATUS') {
    return new ServiceError('CONFLICT', 'Document is not available for signing')
  }
  if (upper === 'SEQUENTIAL_ORDER') {
    return new ServiceError('SEQUENTIAL_ORDER', 'Prior signers must complete before you')
  }
  if (upper === 'INVALID_FIELD' || upper === 'EMPTY_FIELD' || upper === 'SIGNATURE_TOO_LARGE') {
    return new ServiceError('VALIDATION', message || 'Invalid field submitted')
  }
  return new ServiceError('INTERNAL', 'Signing failed', { pgMessage: message, pgCode: code })
}

export const SigningService = {
  /**
   * Get the document, signer, and assigned fields for the signing UI.
   * Throws UNAUTHORIZED if the token doesn't match a signer for this document.
   */
  async getSigningContext(documentId: string, magicToken: string): Promise<SigningContext> {
    const supabase = createAdminClient()

    const { data: signer, error: signerError } = await supabase
      .from('signers')
      .select('id, document_id, email, name, signed_at, token_expires_at')
      .eq('magic_token', magicToken)
      .eq('document_id', documentId)
      .single()

    if (signerError || !signer) {
      throw new ServiceError('UNAUTHORIZED', 'Invalid or expired token')
    }

    if (signer.signed_at) {
      throw new ServiceError('CONFLICT', 'Document already signed')
    }

    if (new Date(signer.token_expires_at) < new Date()) {
      throw new ServiceError('TOKEN_EXPIRED', 'Signing link has expired')
    }

    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, status, content, signers(id, email, name, order, signed_at)')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      throw new ServiceError('NOT_FOUND', 'Document not found')
    }

    const { data: fields, error: fieldsError } = await supabase
      .from('signature_fields')
      .select('id, field_type, position_x, position_y, width, height, is_required, signer_id')
      .eq('document_id', documentId)

    if (fieldsError) {
      logger.error('signing.context.fields_load_failed', fieldsError, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to load signature fields')
    }

    return {
      document: {
        id: document.id,
        title: document.title,
        status: document.status,
        content: document.content ?? null,
        signers: (document.signers ?? []) as SigningContext['document']['signers'],
      },
      signer: { id: signer.id, email: signer.email, name: signer.name, signed_at: signer.signed_at },
      fields: (fields ?? []) as SigningContext['fields'],
    }
  },

  /**
   * Atomically sign a document as a specific signer.
   * Delegates to the PL/pgSQL `sign_document()` function.
   * Sends the completion email if the document is now fully signed.
   * Sends a magic-link email to the next pending signer in sequential mode.
   */
  async signDocument(
    documentId: string,
    magicToken: string,
    fieldValues: Array<{ fieldId: string; value: unknown }>
  ): Promise<SignResult> {
    const supabase = createAdminClient()

    const { data, error } = await supabase.rpc('sign_document', {
      p_document_id: documentId,
      p_magic_token: magicToken,
      p_field_values: fieldValues,
    })

    if (error || !data) {
      logger.error('signing.sign_document.failed', error, { documentId })
      const message = (error?.message ?? '')
      const code = error?.code ?? ''
      throw mapPgErrorToServiceError(message, code)
    }

    const result = data as { success: boolean; documentStatus: string; signerId: string; isSequential: boolean }

    // Fetch document + owner email for the side effects below
    const { data: doc } = await supabase
      .from('documents')
      .select('id, title, user_id, expiration_days')
      .eq('id', documentId)
      .single()

    if (result.documentStatus === 'completed') {
      // Issue certificate of completion (fire-and-forget; cert failure doesn't fail the signing)
      import('@/services/EvidenceService').then(({ EvidenceService }) => {
        EvidenceService.issueCertificate(documentId, { skipTsa: true }).catch(err => {
          logger.error('signing.cert_issue_failed', err, { documentId })
        })
      })

      // Send completion email to owner
      try {
        const { sendCompletionEmail } = await import('@/lib/email/sendCompletionEmail')
        if (doc) {
          let ownerEmail = ''
          let ownerName = 'there'
          const { data: profile } = await supabase
            .from('profiles')
            .select('email, full_name')
            .eq('id', doc.user_id)
            .single()
          if (profile?.email) {
            ownerEmail = profile.email
            ownerName = profile.full_name || 'there'
          } else {
            // Fallback to auth user email
            const { data: authUser } = await supabase.auth.admin.getUserById(doc.user_id)
            ownerEmail = authUser?.user?.email || ''
            ownerName = (authUser?.user?.user_metadata?.full_name as string) || 'there'
          }
          if (ownerEmail) {
            await sendCompletionEmail({
              documentId,
              documentTitle: doc.title,
              ownerEmail,
              ownerName,
              signerCount: 0, // we don't re-query; the email is a notification
              signedAt: new Date().toISOString(),
            })
          }
        }
      } catch (emailErr) {
        logger.error('signing.completion_email_failed', emailErr, { documentId })
      }
    } else if (result.isSequential) {
      // Sequential mode and not yet complete: email the next pending signer
      try {
        const { sendMagicLinkEmail } = await import('@/lib/email/sendMagicLink')
        const { data: pending } = await supabase
          .from('signers')
          .select('id, email, name, order, magic_token')
          .eq('document_id', documentId)
          .is('signed_at', null)
          .order('order', { ascending: true })
          .limit(1)

        const nextSigner = pending?.[0]
        if (nextSigner && doc) {
          await sendMagicLinkEmail(
            { id: nextSigner.id, email: nextSigner.email, name: nextSigner.name || '', magic_token: nextSigner.magic_token },
            { id: doc.id, title: doc.title, expiration_days: doc.expiration_days },
            doc.user_id,
          )
          await addAuditLog(supabase, documentId, 'signer.next_emailed', undefined, { nextSignerId: nextSigner.id })
        }
      } catch (emailErr) {
        logger.error('signing.next_signer_email_failed', emailErr, { documentId })
      }
    }

    return {
      success: true,
      documentStatus: result.documentStatus as SignResult['documentStatus'],
      signerId: result.signerId,
    }
  },
}
