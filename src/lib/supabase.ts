import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
function validUrl(value: string) {
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch { return false; }
}
export const configurationError = Boolean(url) !== Boolean(key) || Boolean(url && !validUrl(url));
export const isDemo = !url && !key;
// Keep even the anonymous session in memory: no cookies or localStorage.
export const supabase = !isDemo && !configurationError ? createClient(url!, key!, {
  auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: true },
}) : null;
