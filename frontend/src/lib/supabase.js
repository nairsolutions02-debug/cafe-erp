import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
    console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key');

// OTP login stays switched off until VITE_OTP_LOGIN=true
export const OTP_LOGIN_ENABLED = import.meta.env.VITE_OTP_LOGIN === 'true';
