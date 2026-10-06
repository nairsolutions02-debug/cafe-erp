import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
// Publishable key (sb_publishable_...) or, for older projects, the legacy anon key
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
    console.error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set');
}

// Which cafe this site belongs to; every request carries it so the database
// shows this cafe's menu and logs staff in to this cafe.
export const TENANT_SLUG = (import.meta.env.VITE_TENANT_SLUG || 'default').trim().toLowerCase();

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
    global: { headers: { 'x-tenant-slug': TENANT_SLUG } },
    // Customers stay signed in on their phone for months: the session is kept in this browser's storage and renewed
    // in the background (the refresh token has no end date unless the Supabase project sets a session time limit).
    auth: { persistSession: true, autoRefreshToken: true },
});

// OTP login stays switched off until VITE_OTP_LOGIN=true
export const OTP_LOGIN_ENABLED = import.meta.env.VITE_OTP_LOGIN === 'true';
