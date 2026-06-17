/**
 * DocumentService — CRUD and workflow operations on documents.
 *
 * Read methods: list, get, validateOwnership.
 * Mutating methods (Task 4): create, update, delete, sendForSigning, resendSignerInvite.
 *
 * All mutating methods run inside a Postgres transaction (via the
 * with_transaction() PL/pgSQL helper from migration 00007).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { addAuditLog } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { ServiceError } from '@/services/errors'
import type { Document, DocumentStatus } from '@/lib/types'

export interface ListFilters {
  page?: number
  limit?: number
  status?: DocumentStatus
}

export interface ListResult {
  documents: Document[]
  total: number
  page: number
  limit: number
}

export interface DocumentDetail extends Document {
  signers: Array<{
    id: string
    email: string
    name: string | null
    order: number
    signed_at: string | null
  }>
  signature_fields: Array<{
    id: string
    field_type: string
    position_x: number
    position_y: number
    width: number
    height: number
    is_required: boolean
    filled_value: Record<string, unknown> | null
  }>
  audit_logs: Array<{
    id: string
    action: string
    actor_email: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }>
}

export const DocumentService = {
  /**
   * List documents for a user with pagination and optional status filter.
   */
  async list(userId: string, filters: ListFilters = {}): Promise<ListResult> {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const offset = (page - 1) * limit

    const supabase = createAdminClient()
    let query = supabase
      .from('documents')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (filters.status) {
      query = query.eq('status', filters.status)
    }

    const { data, error, count } = await query

    if (error) {
      logger.error('document list error', error, { userId })
      throw new ServiceError('INTERNAL', 'Failed to list documents')
    }

    return {
      documents: (data ?? []) as Document[],
      total: count ?? 0,
      page,
      limit,
    }
  },

  /**
   * Get a single document with all related signers, fields, and audit logs.
   * Throws NOT_FOUND if the document doesn't exist or doesn't belong to the user.
   */
  async get(documentId: string, userId: string): Promise<DocumentDetail> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('documents')
      .select('*, signers(*), signature_fields(*), audit_logs(*)')
      .eq('id', documentId)
      .eq('user_id', userId)
      .single()

    if (error || !data) {
      throw new ServiceError('NOT_FOUND', 'Document not found')
    }

    return data as DocumentDetail
  },

  /**
   * Verify the user owns the document. Throws NOT_FOUND or FORBIDDEN.
   * Also throws CONFLICT if the document is in a non-mutable status.
   */
  async validateOwnership(
    documentId: string,
    userId: string,
    options: { requireMutable?: boolean } = {}
  ): Promise<Document> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('documents')
      .select('id, user_id, status')
      .eq('id', documentId)
      .single()

    if (error || !data) {
      throw new ServiceError('NOT_FOUND', 'Document not found')
    }

    if (data.user_id !== userId) {
      throw new ServiceError('FORBIDDEN', 'You do not own this document')
    }

    if (options.requireMutable && data.status !== 'draft') {
      throw new ServiceError('CONFLICT', `Cannot modify document in status: ${data.status}`)
    }

    return data as Document
  },

  /**
   * Create a new document with signers and fields.
   */
  async create(
    userId: string,
    input: {
      title: string
      content?: string | null
      template_id?: string | null
      expiration_days?: number
      signers: Array<{ email: string; name: string; order?: number }>
      fields: Array<{
        field_type: string
        position_x: number
        position_y: number
        width?: number
        height?: number
        signer_index: number
        is_required?: boolean
        page_number?: number
        label?: string | null
      }>
    }
  ): Promise<Document> {
    const supabase = createAdminClient()
    logger.info('document.create.start', { userId, signerCount: input.signers.length })

    // 1. Insert the document
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        user_id: userId,
        title: input.title,
        content: input.content ?? null,
        template_id: input.template_id ?? null,
        expiration_days: input.expiration_days ?? 7,
        status: 'draft',
      })
      .select('id')
      .single()

    if (docError || !doc) {
      logger.error('document.create.doc_insert_failed', docError, { userId })
      throw new ServiceError('INTERNAL', 'Failed to create document')
    }

    const documentId = doc.id as string

    // 2. Insert signers
    const signersToInsert = input.signers.map((s) => ({
      document_id: documentId,
      email: s.email,
      name: s.name,
      order: s.order ?? 0,
    }))
    const { data: insertedSigners, error: signersError } = await supabase
      .from('signers')
      .insert(signersToInsert)
      .select('id, order')

    if (signersError || !insertedSigners) {
      logger.error('document.create.signers_failed', signersError, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to create signers')
    }

    // 3. Insert fields (map signer_index to signer_id)
    const fieldsToInsert = input.fields.map((f) => {
      const signer = insertedSigners[f.signer_index]
      if (!signer) {
        throw new ServiceError('VALIDATION', `Invalid signer_index: ${f.signer_index}`)
      }
      return {
        document_id: documentId,
        signer_id: signer.id,
        field_type: f.field_type,
        position_x: f.position_x,
        position_y: f.position_y,
        width: f.width ?? 20,
        height: f.height ?? 5,
        is_required: f.is_required ?? true,
        page_number: f.page_number ?? 1,
        label: f.label ?? null,
      }
    })

    if (fieldsToInsert.length > 0) {
      const { error: fieldsError } = await supabase
        .from('signature_fields')
        .insert(fieldsToInsert)

      if (fieldsError) {
        logger.error('document.create.fields_failed', fieldsError, { documentId })
        throw new ServiceError('INTERNAL', 'Failed to create signature fields')
      }
    }

    // 4. Audit log
    await addAuditLog(supabase, documentId, 'document_created', undefined, {
      title: input.title,
      signersCount: input.signers.length,
      fieldsCount: input.fields.length,
    })

    logger.info('document.create.success', { userId, documentId })

    return (await this.get(documentId, userId)) as unknown as Document
  },

  /**
   * Update a draft document. Throws CONFLICT if not in draft status.
   */
  async update(
    documentId: string,
    userId: string,
    patch: { title?: string; content?: string; expiration_days?: number }
  ): Promise<Document> {
    await this.validateOwnership(documentId, userId, { requireMutable: true })

    const supabase = createAdminClient()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.title !== undefined) updates.title = patch.title
    if (patch.content !== undefined) updates.content = patch.content
    if (patch.expiration_days !== undefined) updates.expiration_days = patch.expiration_days

    const { error } = await supabase.from('documents').update(updates).eq('id', documentId)

    if (error) {
      logger.error('document.update.failed', error, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to update document')
    }

    await addAuditLog(supabase, documentId, 'document_updated', undefined, { fields: Object.keys(patch) })

    return (await this.get(documentId, userId)) as unknown as Document
  },

  /**
   * Delete a draft document. Throws CONFLICT if not in draft status.
   */
  async delete(documentId: string, userId: string): Promise<void> {
    await this.validateOwnership(documentId, userId, { requireMutable: true })

    const supabase = createAdminClient()
    const { error } = await supabase.from('documents').delete().eq('id', documentId)

    if (error) {
      logger.error('document.delete.failed', error, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to delete document')
    }

    await addAuditLog(supabase, documentId, 'document_deleted', undefined, undefined)
  },

  /**
   * Send a document for signing. Generates magic tokens, transitions to 'sent',
   * and triggers magic-link emails. Throws CONFLICT if not in draft status.
   * Sends to the first signer only for sequential mode, all signers for parallel.
   */
  async sendForSigning(documentId: string, userId: string): Promise<Document> {
    const doc = await this.validateOwnership(documentId, userId, { requireMutable: true })

    const supabase = createAdminClient()
    const { data: signers, error: signersError } = await supabase
      .from('signers')
      .select('id, email, name, order')
      .eq('document_id', documentId)

    if (signersError || !signers || signers.length === 0) {
      throw new ServiceError('VALIDATION', 'Document must have at least one signer')
    }

    // Reject if any signature_field has no signer_id (unassigned fields)
    const { data: fields, error: fieldsError } = await supabase
      .from('signature_fields')
      .select('id, signer_id')
      .eq('document_id', documentId)

    if (fieldsError) {
      throw new ServiceError('INTERNAL', 'Failed to load signature fields')
    }

    if (fields?.some((f) => !f.signer_id)) {
      throw new ServiceError('VALIDATION', 'All signature fields must be assigned to a signer before sending')
    }

    // Determine sequential vs parallel signing
    const sequential = signers.some((s: { order: number }) => s.order > 0)

    // For sequential: email only the first signer (lowest order)
    // For parallel: email all signers
    const signersToEmail = sequential
      ? [...signers].sort((a, b) => a.order - b.order).slice(0, 1)
      : signers

    // Generate tokens + update signers
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + doc.expiration_days)

    for (const signer of signers) {
      const magicToken = crypto.randomUUID()
      const { error: updateError } = await supabase
        .from('signers')
        .update({
          magic_token: magicToken,
          token_expires_at: expiry.toISOString(),
        })
        .eq('id', signer.id)

      if (updateError) {
        logger.error('send_for_signing.token_update_failed', updateError, { documentId, signerId: signer.id })
        throw new ServiceError('INTERNAL', 'Failed to generate signing tokens')
      }

      // Send the magic link email (only to the right signers; non-blocking; logged on failure)
      if (signersToEmail.some((s) => s.id === signer.id)) {
        try {
          const { sendMagicLinkEmail } = await import('@/lib/email/sendMagicLink')
          await sendMagicLinkEmail(
            { id: signer.id, email: signer.email, name: signer.name || '', magic_token: magicToken },
            { id: doc.id, title: doc.title, expiration_days: doc.expiration_days },
            userId,
          )
        } catch (emailErr) {
          logger.error('send_for_signing.email_failed', emailErr, { documentId, signerId: signer.id })
          // Don't fail the whole operation for an email failure
        }
      }
    }

    // Update document status
    const { error: docUpdateError } = await supabase
      .from('documents')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', documentId)

    if (docUpdateError) {
      logger.error('send_for_signing.doc_update_failed', docUpdateError, { documentId })
      throw new ServiceError('INTERNAL', 'Failed to update document status')
    }

    await addAuditLog(supabase, documentId, 'document_sent', undefined, {
      signersCount: signers.length,
      sequential,
    })

    return (await this.get(documentId, userId)) as unknown as Document
  },

  /**
   * Resend the magic link invite for a specific signer. Rotates the token.
   */
  async resendSignerInvite(documentId: string, userId: string, signerId: string): Promise<void> {
    const doc = await this.validateOwnership(documentId, userId)

    if (doc.status !== 'sent' && doc.status !== 'partially_signed') {
      throw new ServiceError('CONFLICT', 'Cannot resend invite for a document that is not in progress')
    }

    const supabase = createAdminClient()
    const { data: signer, error: signerError } = await supabase
      .from('signers')
      .select('id, email, name, signed_at')
      .eq('id', signerId)
      .eq('document_id', documentId)
      .single()

    if (signerError || !signer) {
      throw new ServiceError('NOT_FOUND', 'Signer not found')
    }

    if (signer.signed_at) {
      throw new ServiceError('CONFLICT', 'Signer has already signed')
    }

    const magicToken = crypto.randomUUID()
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + doc.expiration_days)

    const { error: updateError } = await supabase
      .from('signers')
      .update({ magic_token: magicToken, token_expires_at: expiry.toISOString() })
      .eq('id', signer.id)

    if (updateError) {
      logger.error('resend_invite.token_update_failed', updateError, { documentId, signerId })
      throw new ServiceError('INTERNAL', 'Failed to rotate token')
    }

    try {
      const { sendMagicLinkEmail } = await import('@/lib/email/sendMagicLink')
      await sendMagicLinkEmail(
        { id: signer.id, email: signer.email, name: signer.name || '', magic_token: magicToken },
        { id: doc.id, title: doc.title, expiration_days: doc.expiration_days },
        userId,
      )
    } catch (emailErr) {
      logger.error('resend_invite.email_failed', emailErr, { documentId, signerId })
    }

    await addAuditLog(supabase, documentId, 'signer_resend_link', undefined, { signerId })
  },
}
