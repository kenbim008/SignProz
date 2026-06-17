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
}
