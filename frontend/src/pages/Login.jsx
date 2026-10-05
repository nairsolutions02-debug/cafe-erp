import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Login.css';
import { useBrand } from '../context/BrandContext';
import QuickLoginForm from '../components/QuickLoginForm';
import { OTP_LOGIN_ENABLED } from '../lib/supabase';

const Login = () => {
    const brand = useBrand();
    const [step, setStep] = useState('phone'); // phone, otp, profile
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [devOtp, setDevOtp] = useState('');
    const [resendTimer, setResendTimer] = useState(0);
    const [otpLength, setOtpLength] = useState(4);
    const isSubmittingRef = useRef(false);

    const { sendOTP, verifyOTP, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const returnTo = location.state?.from || '/';

    // Redirect if already logged in
    useEffect(() => {
        if (isAuthenticated) {
            navigate(returnTo);
        }
    }, [isAuthenticated, navigate, returnTo]);

    // Resend timer countdown
    useEffect(() => {
        if (resendTimer > 0) {
            const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [resendTimer]);

    const handleSendOTP = async (e) => {
        e.preventDefault();
        if (phone.length !== 10) {
            setError('Please enter a valid 10-digit phone number');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const res = await sendOTP(phone);
            if (res.otp) setDevOtp(res.otp); // For development
            if (res.otpLength) setOtpLength(res.otpLength);
            setResendTimer(30); // 30 seconds cooldown
            setStep('otp');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to send OTP');
        } finally {
            setLoading(false);
        }
    };

    const handleResendOTP = async () => {
        if (resendTimer > 0) return;

        setLoading(true);
        setError('');

        try {
            const res = await sendOTP(phone);
            if (res.otp) setDevOtp(res.otp);
            setResendTimer(30);
            setOtp('');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to resend OTP');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOTP = async (e) => {
        e.preventDefault();
        if (otp.length !== otpLength) {
            setError(`Please enter a valid ${otpLength}-digit OTP`);
            return;
        }

        // Check if name is empty - need to go to profile step
        if (!name.trim()) {
            setStep('profile');
            return;
        }

        await submitVerification();
    };

    const handleProfileSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) {
            setError('Please enter your name');
            return;
        }
        await submitVerification();
    };

    const submitVerification = async (otpValue = null) => {
        setLoading(true);
        setError('');

        // Use passed otpValue or fall back to state
        const otpToVerify = otpValue || otp;

        try {
            await verifyOTP(phone, otpToVerify, name.trim(), email.trim());
            navigate(returnTo);
        } catch (err) {
            if (err.response?.data?.requiresProfile) {
                setStep('profile');
            } else {
                setError(err.response?.data?.message || 'Invalid OTP');
            }
            isSubmittingRef.current = false; // Reset on error to allow retry
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-header">
                <img src={brand.logo} alt={brand.name} className="login-logo-img" />
                <h1>{brand.name}</h1>
                <p>{brand.tagline}</p>
            </div>

            <div className="login-card">
                {!OTP_LOGIN_ENABLED ? <QuickLoginForm title="Welcome!" titleClassName="login-title" subtitleClassName="login-subtitle" /> : (<>
                {step === 'phone' && (
                    <form onSubmit={handleSendOTP}>
                        <h2>Welcome!</h2>
                        <p className="login-subtitle">Enter your phone number to continue</p>

                        <div className="phone-input-group">
                            <span className="country-code">+91</span>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                placeholder="Enter phone number"
                                className="phone-input"
                                autoFocus
                            />
                        </div>

                        {error && <p className="error-message">{error}</p>}

                        <button type="submit" className="btn btn-primary btn-full" disabled={loading || phone.length !== 10}>
                            {loading ? 'Sending...' : 'Get OTP'}
                        </button>
                    </form>
                )}

                {step === 'otp' && (
                    <form onSubmit={handleVerifyOTP}>
                        <h2>Verify OTP</h2>
                        <p className="login-subtitle">
                            Enter the {otpLength}-digit code sent to +91 {phone}
                            <button type="button" className="change-number" onClick={() => { setStep('phone'); setOtp(''); setError(''); }}>
                                Change
                            </button>
                        </p>

                        {devOtp && (
                            <div className="dev-otp-notice">
                                Development OTP: <strong>{devOtp}</strong>
                            </div>
                        )}

                        <input
                            type="tel"
                            value={otp}
                            onChange={(e) => {
                                const value = e.target.value.replace(/\D/g, '').slice(0, otpLength);
                                setOtp(value);

                                // Auto-submit when OTP length is complete
                                if (value.length === otpLength && !loading && !isSubmittingRef.current) {
                                    isSubmittingRef.current = true;
                                    // Small delay to show the last digit, then go to profile step if needed
                                    setTimeout(() => {
                                        if (!name.trim()) {
                                            setStep('profile');
                                            isSubmittingRef.current = false;
                                        } else {
                                            submitVerification(value);  // Pass value directly
                                        }
                                    }, 150);
                                }
                            }}
                            placeholder={`Enter ${otpLength}-digit OTP`}
                            className="input otp-input"
                            autoFocus
                            maxLength={otpLength}
                        />

                        <div className="resend-section">
                            {resendTimer > 0 ? (
                                <span className="resend-timer">Resend OTP in {resendTimer}s</span>
                            ) : (
                                <button type="button" className="resend-btn" onClick={handleResendOTP} disabled={loading}>
                                    Resend OTP
                                </button>
                            )}
                        </div>

                        {error && <p className="error-message">{error}</p>}

                        {loading && (
                            <div className="verifying-message">
                                <span className="spinner-small"></span>
                                Verifying...
                            </div>
                        )}
                    </form>
                )}

                {step === 'profile' && (
                    <form onSubmit={handleProfileSubmit}>
                        <h2>Almost Done!</h2>
                        <p className="login-subtitle">Please enter your details to continue</p>

                        <div className="profile-fields">
                            <div className="input-group">
                                <label>Name <span className="required">*</span></label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Enter your name"
                                    className="input"
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="input-group">
                                <label>Email <span className="optional">(Optional)</span></label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Enter email address"
                                    className="input"
                                />
                            </div>
                        </div>

                        {error && <p className="error-message">{error}</p>}

                        <button type="submit" className="btn btn-primary btn-full" disabled={loading || !name.trim()}>
                            {loading ? 'Please wait...' : 'Continue'}
                        </button>
                    </form>
                )}
                </>)}
            </div>

            <p className="login-footer">
                By continuing, you agree to our Terms of Service
            </p>
        </div>
    );
};

export default Login;

