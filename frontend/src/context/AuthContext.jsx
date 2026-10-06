import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { createRealtimeSocket } from '../lib/realtime';
import { can } from '../lib/permissions';
import { setSessionTenant } from '../utils/api';
import { saveMe, forgetMe } from '../lib/cxMe';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

// Errors in the shape the pages already read: err.response.data.message
const apiError = (message, extra = {}) => {
    const err = new Error(message);
    err.response = { data: { message, ...extra } };
    return err;
};

// Anonymous Supabase session for this device (customers never see a password)
const ensureSession = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    const { data: signedIn, error } = await supabase.auth.signInAnonymously();
    if (error) throw apiError(error.message);
    return signedIn.session;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [socket, setSocket] = useState(null);

    const fetchUser = useCallback(async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
            setUser(null);
            return null;
        }
        const { data, error } = await supabase.rpc('me');
        const me = error ? null : data;
        // A customer: remember name + mobile on this phone for a one-tap sign-in if the session is ever lost
        if (me?.role === 'customer' && me.phone) saveMe(me);
        setUser(me);
        setSessionTenant(me?.tenant?.id);
        return me;
    }, []);

    useEffect(() => {
        fetchUser().finally(() => setLoading(false));
        // Renew the sign-in on every visit (a fresh refresh token each time), so it never runs out while they keep coming
        supabase.auth.getSession().then(({ data }) => {
            const s = data.session;
            if (s?.expires_at && s.expires_at * 1000 - Date.now() < 50 * 60 * 1000) supabase.auth.refreshSession().catch(() => {});
        });
        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') setUser(null);
        });
        return () => sub.subscription.unsubscribe();
    }, [fetchUser]);

    // Live updates; reconnect when the signed-in user changes so row level
    // security filters events for the right person
    useEffect(() => {
        const live = createRealtimeSocket();
        setSocket(live);
        return () => live.close();
    }, [user?._id]);

    // Default login: name + mobile number, no OTP
    const customerSignIn = async (name, phone, email = '') => {
        await ensureSession();
        const { error } = await supabase.rpc('customer_sign_in', { p_name: name, p_phone: phone, p_email: email });
        if (error) throw apiError(error.message);
        return fetchUser();
    };

    // OTP login (dormant until VITE_OTP_LOGIN=true and the phone-otp function is deployed)
    const callOtpFunction = async (body) => {
        await ensureSession();
        const { data, error } = await supabase.functions.invoke('phone-otp', { body });
        if (error) {
            let payload = {};
            try { payload = await error.context.json(); } catch { /* not JSON */ }
            throw apiError(payload.message || 'OTP service unavailable', payload);
        }
        return data;
    };

    const sendOTP = (phone) => callOtpFunction({ action: 'send', phone });

    const verifyOTP = async (phone, otp, name, email) => {
        await callOtpFunction({ action: 'verify', phone, otp, name, email });
        return fetchUser();
    };

    // Owner (or platform admin) login with email + password
    const adminLogin = async (email, password, { platform = false } = {}) => {
        await supabase.auth.signOut();
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw apiError('Invalid credentials');
        const me = await fetchUser();
        const expected = platform ? 'platform' : 'admin';
        if (me?.role !== expected) {
            await supabase.auth.signOut();
            setUser(null);
            throw apiError(platform ? 'This account is not a platform admin' : 'This account is not an admin');
        }
        return me;
    };

    // Staff login on any device: phone + PIN for this cafe
    const staffLogin = async (phone, pin) => {
        await supabase.auth.signOut();
        await ensureSession();
        const { data, error } = await supabase.rpc('staff_pin_login', { p_phone: phone, p_pin: pin });
        if (error) throw apiError(error.message);
        if (!data?.ok) {
            await supabase.auth.signOut();
            throw apiError(data?.message || 'Invalid phone or PIN');
        }
        return fetchUser();
    };

    const logout = async () => {
        // Logging out on purpose: this phone no longer offers "Welcome back, <name>?"
        if (user?.role === 'customer') forgetMe();
        await supabase.auth.signOut();
        setUser(null);
    };

    const updateProfile = async (data) => {
        const { data: me, error } = await supabase.rpc('update_my_profile', {
            p_name: data.name ?? '', p_email: data.email ?? '',
        });
        if (error) throw apiError(error.message);
        setUser(me);
        return me;
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            socket,
            customerSignIn,
            sendOTP,
            verifyOTP,
            adminLogin,
            staffLogin,
            logout,
            updateProfile,
            refreshUser: fetchUser,
            isAuthenticated: !!user,
            isAdmin: user?.role === 'admin',
            isPlatform: user?.role === 'platform',
            // Before the Phase 0 database upgrade, owners have no permission list: treat as full access
            permissions: user?.permissions || (user?.role === 'admin' ? ['*'] : []),
            hasPerm: (perm) => can(user?.permissions || (user?.role === 'admin' ? ['*'] : []), perm),
            tenant: user?.tenant || null
        }}>
            {children}
        </AuthContext.Provider>
    );
};
