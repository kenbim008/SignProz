import { createServerClient } from '@/lib/supabase/server'

export interface SessionUser {
  id: string
  email: string
}

export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user || !user.email) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
  }
}
