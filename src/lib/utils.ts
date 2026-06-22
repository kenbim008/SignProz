import { v4 as uuidv4 } from 'uuid'
import { createAdminClient } from '@/lib/supabase/admin'

export function generateMagicToken(): string {
  return uuidv4()
}

export function getTokenExpiry(daysFromNow: number): Date {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + daysFromNow)
  return expiry
}

export function isTokenExpired(expiresAt: string | Date): boolean {
  return new Date(expiresAt) < new Date()
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function isSequentialSigning(signers: { order: number }[]): boolean {
  if (signers.length === 0) return false
  return signers.some((s) => s.order > 0)
}

export async function addAuditLog(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  documentId: string,
  action: string,
  actorEmail?: string,
  metadata?: Record<string, unknown>,
  ipAddress?: string
) {
  await supabaseAdmin.from('audit_logs').insert({
    document_id: documentId,
    action,
    actor_email: actorEmail || null,
    metadata: metadata || null,
    ip_address: ipAddress || null,
  })
}

export function apiError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

export function apiSuccess(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}
