/** Turn Supabase Auth errors into plain advice. Unknown messages pass through unchanged. */
export function authMessage(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Wrong email or password.'
  if (m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists. Use "Sign in" instead.'
  if (m.includes('email not confirmed'))
    return 'This account still waits for email confirmation. In Supabase, turn off "Confirm email" (see README), or open the confirmation email once.'
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'Creating new accounts is turned off for this app. Sign in with the existing account.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a few minutes and try again.'
  if (m.includes('failed to fetch') || m.includes('network')) return "Can't reach the sync server. Check your connection."
  if (m.includes('same as the old') || m.includes('different from the old')) return 'The new password must be different from the old one.'
  return raw
}
