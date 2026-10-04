import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getClubPublicConfig, setMyBirthday } from '../utils/api';
import '../pages/Login.css';
import '../pages/club/Club.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// First visit (e.g. after scanning the table QR): name + mobile, no OTP.
// The same mobile on another phone opens the same customer account.
const QuickLoginForm = ({ title = 'Welcome! 👋', titleClassName = 'modal-title', subtitleClassName = 'modal-subtitle', onSuccess }) => {
    const { customerSignIn } = useAuth();
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    // Optional birthday (day and month), when the cafe asks for it
    const [club, setClub] = useState(null);
    const [bday, setBday] = useState({ day: '', month: '' });
    useEffect(() => { getClubPublicConfig().then(r => setClub(r.data)).catch(() => {}); }, []);
    const bdayHalf = (bday.day && !bday.month) || (!bday.day && bday.month);

    const valid = name.trim().length > 0 && /^[6-9]\d{9}$/.test(phone);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError('Please enter your name');
        if (!/^[6-9]\d{9}$/.test(phone)) return setError('Please enter a valid 10-digit mobile number');
        if (bday.day && bday.month && Number(bday.day) > new Date(2000, Number(bday.month), 0).getDate()) {
            return setError(`${MONTHS[bday.month - 1]} has only ${new Date(2000, Number(bday.month), 0).getDate()} days`);
        }

        setLoading(true);
        setError('');
        try {
            await customerSignIn(name.trim(), phone);
            if (bday.day && bday.month) {
                // Already saved earlier (returning customer)? Their saved date stays; nothing to show here
                await setMyBirthday(bday.day, bday.month).catch(() => {});
            }
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

            {club?.askBirthday && (
                <div className="cl-ask" style={{ margin: '4px 0 12px' }}>
                    <p><b><span className="cl-cake" aria-hidden="true" style={{ display: 'inline-block', fontSize: '1.1rem' }}>🎁</span> Get a surprise on your birthday</b> <small>(optional)</small>
                        {club.birthdayGift ? <><br /><small>Add your birthday and we'll have a gift waiting: {club.birthdayGift}.</small></> : null}</p>
                    <div className="cl-dob">
                        <label htmlFor="qb-day">Day
                            <select id="qb-day" value={bday.day} onChange={e => setBday({ ...bday, day: e.target.value })}>
                                <option value="">Day</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                            </select></label>
                        <label htmlFor="qb-month">Month
                            <select id="qb-month" value={bday.month} onChange={e => setBday({ ...bday, month: e.target.value })}>
                                <option value="">Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                            </select></label>
                    </div>
                    <p className="cl-small muted">🔒 You can set this once. Wrong date later? Ask the cafe to fix it.</p>
                </div>
            )}

            {error && <p className="error-message">{error}</p>}

            <button type="submit" className="btn btn-primary btn-full" disabled={loading || !valid || bdayHalf}>
                {loading ? 'Please wait...' : 'Continue'}
            </button>
        </form>
    );
};

export default QuickLoginForm;
