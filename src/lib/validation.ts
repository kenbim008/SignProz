import { z } from 'zod'

export const emailSchema = z.string().email('Invalid email address')

export const registerStartSchema = z.object({
  email: emailSchema,
  referralCode: z.string().optional(),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).optional(),
})

export const createDocumentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  content: z.string().optional(),
  template_id: z.string().optional(),
  expiration_days: z.number().int().min(1).max(365).optional().default(7),
})

export const otpSchema = z.object({
  otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/),
})

export const setPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
