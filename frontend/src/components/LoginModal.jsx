import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import './LoginModal.css';
import { useBrand } from '../context/BrandContext';
import QuickLoginForm from './QuickLoginForm';
import { OTP_LOGIN_ENABLED } from '../lib/supabase';
import useCxLang, { T } from '../lib/cxLang';
import { LangChips } from './cx/LangPicker';

const W = {
    badPhone: T('Please enter a valid 10-digit phone number', 'कृपया सही 10 अंकों का फ़ोन नंबर लिखें', 'Please sahi 10-digit phone number likho'),
    sendFailed: T('Failed to send OTP', 'OTP नहीं भेज पाए', 'OTP nahi bhej paaye'),
    resendFailed: T('Failed to resend OTP', 'OTP दोबारा नहीं भेज पाए', 'OTP dobara nahi bhej paaye'),
    badOtp: T('Please enter a valid {n}-digit OTP', 'कृपया सही {n} अंकों का OTP लिखें', 'Please sahi {n}-digit OTP likho'),
    enterName: T('Please enter your name', 'कृपया अपना नाम लिखें', 'Please apna naam likho'),
    invalidOtp: T('Invalid OTP', 'OTP गलत है', 'OTP galat hai'),
    asPlatform: T('Signed in as platform admin', 'प्लेटफ़ॉर्म एडमिन के रूप में लॉग इन', 'Platform admin ke roop mein login'),
    asStaff: T('Signed in as staff', 'स्टाफ़ के रूप में लॉग इन', 'Staff ke roop mein login'),
    adminNote: T('This browser is logged in to the admin panel. To order as a customer, log out of admin here or use another browser / incognito window.',
        'यह ब्राउज़र एडमिन पैनल में लॉग इन है। ग्राहक की तरह ऑर्डर करने के लिए यहाँ एडमिन से लॉग आउट करें या दूसरा ब्राउज़र / इनकॉग्निटो विंडो खोलें।',
        'Ye browser admin panel mein login hai. Customer ki tarah order karne ke liye yahan admin se logout karo ya doosra browser / incognito window kholo.'),
    logout: T('Log out', 'लॉग आउट', 'Logout'),
    backAdmin: T('Back to admin panel', 'एडमिन पैनल पर वापस', 'Admin panel pe wapas'),
    welcome: T('Welcome! 👋', 'स्वागत है! 👋', 'Welcome! 👋'),
    phoneSub: T('Enter your phone number to continue', 'आगे बढ़ने के लिए अपना फ़ोन नंबर लिखें', 'Aage badhne ke liye apna phone number likho'),
    phonePh: T('Enter phone number', 'फ़ोन नंबर लिखें', 'Phone number likho'),
    sending: T('Sending...', 'भेज रहे हैं...', 'Bhej rahe hain...'),
    getOtp: T('Get OTP', 'OTP पाएँ', 'OTP bhejo'),
    verifyTitle: T('Verify OTP 📱', 'OTP डालें 📱', 'OTP daalo 📱'),
    codeSent: T('Enter the {n}-digit code sent to +91 {phone}', '+91 {phone} पर भेजा गया {n} अंकों का कोड लिखें', '+91 {phone} pe bheja gaya {n}-digit code likho'),
    change: T('Change', 'बदलें', 'Badlo'),
    otpPh: T('Enter {n}-digit OTP', '{n} अंकों का OTP लिखें', '{n}-digit OTP likho'),
    resendIn: T('Resend OTP in {s}s', '{s} सेकंड में OTP दोबारा भेजें', '{s}s mein OTP dobara bhejo'),
    resend: T('Resend OTP', 'OTP दोबारा भेजें', 'OTP dobara bhejo'),
    verifying: T('Verifying...', 'जाँच रहे हैं...', 'Check kar rahe hain...'),
    changeNumber: T('← Change Number', '← नंबर बदलें', '← Number badlo'),
    almost: T('Almost Done! ✨', 'बस हो गया! ✨', 'Bas ho gaya! ✨'),
    details: T('Please enter your details', 'कृपया अपनी जानकारी लिखें', 'Please apni details likho'),
    name: T('Name', 'नाम', 'Naam'),
    namePh: T('Enter your name', 'अपना नाम लिखें', 'Apna naam likho'),
    email: T('Email', 'ईमेल', 'Email'),
    optional: T('(Optional)', '(वैकल्पिक)', '(optional)'),
    emailPh: T('Enter email address', 'ईमेल पता लिखें', 'Email address likho'),
    wait: T('Please wait...', 'रुकिए...', 'Ruko...'),
    continue: T('Continue', 'आगे बढ़ें', 'Aage badho'),
    consent: T('By continuing, you agree to our Terms of Service and to the cafe saving your name, number and birthday (if given) for orders and rewards. You can ask to delete them anytime.',
        'आगे बढ़कर आप हमारी सेवा की शर्तें मानते हैं, और कैफ़े ऑर्डर व रिवॉर्ड के लिए आपका नाम, नंबर और जन्मदिन (अगर दिया) सेव रखेगा। आप कभी भी इन्हें हटाने को कह सकते हैं।',
        'Aage badhke aap hamari Terms of Service maante ho, aur cafe orders aur rewards ke liye aapka naam, number aur birthday (agar diya) save rakhega. Aap kabhi bhi inhe delete karne ko keh sakte ho.'),
};

const LoginModal = () => {
    const brand = useBrand();
    const { t } = useCxLang();
    const [step, setStep] = useState('phone'); // phone, otp, profile
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [devOtp, setDevOtp] = useState('');
    const [resendTimer, setResendTimer] = useState(0);
    const [otpLength, setOtpLength] = useState(6);
    const isSubmittingRef = useRef(false);

    const { sendOTP, verifyOTP, isAdmin, isPlatform, logout } = useAuth();

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
            setError(t(W.badPhone));
            return;
        }

        setLoading(true);
        setError('');

        try {
            const res = await sendOTP(phone);
            if (res.otp) setDevOtp(res.otp);
            if (res.otpLength) setOtpLength(res.otpLength);
            setResendTimer(30);
            setStep('otp');
        } catch (err) {
            setError(err.response?.data?.message || t(W.sendFailed));
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
            setError(err.response?.data?.message || t(W.resendFailed));
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOTP = async (e) => {
        e.preventDefault();
        if (otp.length !== otpLength) {
            setError(t(W.badOtp, { n: otpLength }));
            return;
        }

        // Try verification - backend will tell us if profile is needed
        await submitVerification();
    };

    const handleProfileSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) {
            setError(t(W.enterName));
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
            // Auth context will update and modal will close automatically
        } catch (err) {
            if (err.response?.data?.requiresProfile) {
                setStep('profile');
            } else {
                setError(err.response?.data?.message || t(W.invalidOtp));
            }
            isSubmittingRef.current = false; // Reset on error to allow retry
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-modal-overlay">
            <div className="login-modal">
                <div className="login-modal-header">
                    <img src={brand.logo} alt={brand.name} className="modal-logo" />
                    <h2>{brand.name}</h2>
                </div>

                <div className="login-modal-content">
                    {isAdmin || isPlatform ? (
                        <div>
                            <p className="modal-title">{t(isPlatform ? W.asPlatform : W.asStaff)}</p>
                            <p className="modal-subtitle">
                                {t(W.adminNote)}
                            </p>
                            <button type="button" className="btn btn-primary btn-full" onClick={logout}>
                                {t(W.logout)}
                            </button>
                            <a href="/admin" className="btn btn-ghost btn-full">{t(W.backAdmin)}</a>
                        </div>
                    ) : !OTP_LOGIN_ENABLED ? <QuickLoginForm /> : (<>
                    {step === 'phone' && (
                        <form onSubmit={handleSendOTP}>
                            <p className="modal-title">{t(W.welcome)}</p>
                            <p className="modal-subtitle">{t(W.phoneSub)}</p>
                            <div style={{ margin: '0 0 14px' }}>
                                <small className="muted" style={{ display: 'block', marginBottom: 6 }}>Language · भाषा</small>
                                <LangChips />
                            </div>

                            <div className="phone-input-group">
                                <span className="country-code">+91</span>
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                    placeholder={t(W.phonePh)}
                                    className="phone-input"
                                    autoFocus
                                />
                            </div>

                            {error && <p className="error-message">{error}</p>}

                            <button type="submit" className="btn btn-primary btn-full" disabled={loading || phone.length !== 10}>
                                {loading ? t(W.sending) : t(W.getOtp)}
                            </button>
                        </form>
                    )}

                    {step === 'otp' && (
                        <form onSubmit={handleVerifyOTP}>
                            <p className="modal-title">{t(W.verifyTitle)}</p>
                            <p className="modal-subtitle">
                                {t(W.codeSent, { n: otpLength, phone })}
                                <button type="button" className="change-number" onClick={() => { setStep('phone'); setOtp(''); setError(''); }}>
                                    {t(W.change)}
                                </button>
                            </p>

                            {devOtp && (
                                <div className="dev-otp-notice">
                                    Dev OTP: <strong>{devOtp}</strong>
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
                                        // Small delay to show the last digit
                                        setTimeout(() => {
                                            submitVerification(value);  // Pass value directly
                                        }, 150);
                                    }
                                }}
                                placeholder={t(W.otpPh, { n: otpLength })}
                                className="input otp-input"
                                autoFocus
                                maxLength={otpLength}
                            />

                            <div className="resend-section">
                                {resendTimer > 0 ? (
                                    <span className="resend-timer">{t(W.resendIn, { s: resendTimer })}</span>
                                ) : (
                                    <button type="button" className="resend-btn" onClick={handleResendOTP} disabled={loading}>
                                        {t(W.resend)}
                                    </button>
                                )}
                            </div>

                            {error && <p className="error-message">{error}</p>}

                            {loading && (
                                <div className="verifying-message">
                                    <span className="spinner-small"></span>
                                    {t(W.verifying)}
                                </div>
                            )}
                        </form>
                    )}

                    {step === 'profile' && (
                        <form onSubmit={handleProfileSubmit}>
                            <button
                                type="button"
                                className="back-btn"
                                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                            >
                                {t(W.changeNumber)}
                            </button>
                            <p className="modal-title">{t(W.almost)}</p>
                            <p className="modal-subtitle">{t(W.details)}</p>

                            <div className="profile-fields">
                                <div className="input-group">
                                    <label>{t(W.name)} <span className="required">*</span></label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder={t(W.namePh)}
                                        className="input"
                                        autoFocus
                                        required
                                    />
                                </div>
                                <div className="input-group">
                                    <label>{t(W.email)} <span className="optional">{t(W.optional)}</span></label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder={t(W.emailPh)}
                                        className="input"
                                    />
                                </div>
                            </div>

                            {error && <p className="error-message">{error}</p>}

                            <button type="submit" className="btn btn-primary btn-full" disabled={loading || !name.trim()}>
                                {loading ? t(W.wait) : t(W.continue)}
                            </button>
                        </form>
                    )}
                    </>)}
                </div>

                <p className="modal-footer">
                    {t(W.consent)}
                </p>
            </div>
        </div>
    );
};

export default LoginModal;
