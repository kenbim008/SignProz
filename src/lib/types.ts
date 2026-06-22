export type DocumentStatus = 'draft' | 'sent' | 'partially_signed' | 'completed' | 'expired'
export type PlanTier = 'free' | 'pro' | 'premium' | 'enterprise'
export type FieldType = 'signature' | 'initials' | 'date' | 'text'
export type AffiliateStatus = 'registered' | 'upgraded' | 'churned'

export interface Document {
  id: string
  user_id: string
  title: string
  status: DocumentStatus
  content: string | null
  template_id: string | null
  expiration_days: number
  sent_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Signer {
  id: string
  document_id: string
  email: string
  name: string | null
  magic_token: string
  token_expires_at: string
  viewed_at: string | null
  signed_at: string | null
  signed_data: Record<string, unknown> | null
  order: number
  created_at: string
}

export interface SignatureField {
  id: string
  document_id: string
  signer_id: string | null
  field_type: FieldType
  position_x: number
  position_y: number
  width: number
  height: number
  is_required: boolean
  filled_value: Record<string, unknown> | null
  created_at: string
}

export interface AuditLog {
  id: string
  document_id: string
  actor_email: string | null
  action: string
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export interface SignRequestBody {
  token: string
  fields: { fieldId: string; value: unknown }[]
}

export interface AddSignerBody {
  email: string
  name: string
  order?: number
}

export interface AddFieldBody {
  field_type: FieldType
  position_x: number
  position_y: number
  width?: number
  height?: number
  signer_id?: string
  is_required?: boolean
}

export interface AgreementAnalyzeResponse {
  summary: string
  keyTerms: string[]
  riskFlags: { level: 'low' | 'medium' | 'high'; description: string }[]
  recommendedActions: string[]
}

export interface RegistrationSession {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  has_verified_email: boolean
  has_verified_phone: boolean
  referral_code: string | null
  created_at: string
}

export interface RegistrationStartBody {
  email: string
  referralCode?: string
}

export interface RegistrationSessionBody {
  fullName?: string
  phone?: string
  hasVerifiedEmail?: boolean
  hasVerifiedPhone?: boolean
}

export interface SetPasswordBody {
  password: string
}

export type SignupStep = 'email' | 'details' | 'verify-email' | 'verify-phone-password'
