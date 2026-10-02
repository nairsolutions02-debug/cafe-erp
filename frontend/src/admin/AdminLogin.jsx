import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './AdminLogin.css';
import brand from '../brand';

// Staff sign in with phone + PIN (default); the owner can also use email + password.
const AdminLogin = () => {
    const [mode, setMode] = useState('pin');
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { adminLogin, staffLogin } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            if (mode === 'pin') await staffLogin(phone, pin);
            else await adminLogin(email, password);
            navigate('/admin');
        } catch (err) {
            setError(err.response?.data?.message || 'Invalid credentials');
            setPin('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="admin-login-page">
            <div className="admin-login-card">
                <div className="admin-login-header">
                    <span className="admin-logo">🍽️</span>
                    <h1>Staff Login</h1>
                    <p>{brand.name} Management</p>
                </div>

                <div className="login-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={mode === 'pin'}
                        className={mode === 'pin' ? 'active' : ''} onClick={() => { setMode('pin'); setError(''); }}>
                        Phone + PIN
                    </button>
                    <button type="button" role="tab" aria-selected={mode === 'email'}
                        className={mode === 'email' ? 'active' : ''} onClick={() => { setMode('email'); setError(''); }}>
                        Owner email
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    {mode === 'pin' ? (
                        <>
                            <div className="input-group">
                                <label>Mobile number</label>
                                <input
                                    type="tel"
                                    inputMode="numeric"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                    placeholder="10-digit mobile"
                                    autoComplete="username"
                                    className="input"
                                    required
                                />
                            </div>
                            <div className="input-group">
                                <label>PIN</label>
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    value={pin}
                                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="4–6 digit PIN"
                                    autoComplete="current-password"
                                    className="input pin-input"
                                    required
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="input-group">
                                <label>Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Enter admin email"
                                    autoComplete="username"
                                    className="input"
                                    required
                                />
                            </div>
                            <div className="input-group">
                                <label>Password</label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter password"
                                    autoComplete="current-password"
                                    className="input"
                                    required
                                />
                            </div>
                        </>
                    )}

                    {error && <p className="error-message">{error}</p>}

                    <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                        {loading ? 'Logging in...' : 'Login'}
                    </button>
                    {mode === 'pin' && <p className="login-hint">Forgot your PIN? Ask the owner or manager to reset it.</p>}
                </form>
            </div>
        </div>
    );
};

export default AdminLogin;
