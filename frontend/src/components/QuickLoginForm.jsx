import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../pages/Login.css';

// First visit (e.g. after scanning the table QR): name + mobile, no OTP.
// The same mobile on another phone opens the same customer account.
const QuickLoginForm = ({ title = 'Welcome! 👋', titleClassName = 'modal-title', subtitleClassName = 'modal-subtitle', onSuccess }) => {
    const { customerSignIn } = useAuth();
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const valid = name.trim().length > 0 && /^[6-9]\d{9}$/.test(phone);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError('Please enter your name');
        if (!/^[6-9]\d{9}$/.test(phone)) return setError('Please enter a valid 10-digit mobile number');

        setLoading(true);
        setError('');
        try {
            await customerSignIn(name.trim(), phone);
            onSuccess?.();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not sign in. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <p className={titleClassName}>{title}</p>
            <p className={subtitleClassName}>Tell us your name and mobile number to order</p>

            <div className="profile-fields">
                <div className="input-group">
                    <label>Name <span className="required">*</span></label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="input"
                        autoComplete="name"
                        autoFocus
                        required
                    />
                </div>
            </div>

            <div className="phone-input-group">
                <span className="country-code">+91</span>
                <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="Mobile number"
                    className="phone-input"
                    autoComplete="tel-national"
                />
            </div>

            {error && <p className="error-message">{error}</p>}

            <button type="submit" className="btn btn-primary btn-full" disabled={loading || !valid}>
                {loading ? 'Please wait...' : 'Continue'}
            </button>
        </form>
    );
};

export default QuickLoginForm;
