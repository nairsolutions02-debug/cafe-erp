import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getClubPublicConfig, setMyBirthday } from '../utils/api';
import '../pages/Login.css';
import '../pages/club/Club.css';
import useCxLang, { T, sayReward } from '../lib/cxLang';
import { LangChips } from './cx/LangPicker';

const MONTHS = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};
const W = {
    welcome: T('Welcome!', 'स्वागत है!', 'Welcome!'),
    subtitle: T('Tell us your name and mobile number to order', 'ऑर्डर करने के लिए अपना नाम और मोबाइल नंबर बताएँ', 'Order karne ke liye apna naam aur mobile number batao'),
    name: T('Name', 'नाम', 'Naam'),
    namePh: T('Your name', 'आपका नाम', 'Aapka naam'),
    mobilePh: T('Mobile number', 'मोबाइल नंबर', 'Mobile number'),
    enterName: T('Please enter your name', 'कृपया अपना नाम लिखें', 'Please apna naam likho'),
    enterMobile: T('Please enter a valid 10-digit mobile number', 'कृपया सही 10 अंकों का मोबाइल नंबर लिखें', 'Please sahi 10-digit mobile number likho'),
    monthDays: T('{month} has only {n} days', '{month} में सिर्फ़ {n} दिन होते हैं', '{month} mein sirf {n} din hote hain'),
    signInFailed: T('Could not sign in. Please try again.', 'साइन इन नहीं हो पाया। फिर से कोशिश करें।', 'Sign in nahi ho paya. Phir se try karo.'),
    bdayAsk: T('Get a surprise on your birthday', 'जन्मदिन पर सरप्राइज़ पाएँ', 'Birthday pe surprise pao'),
    optional: T('(optional)', '(वैकल्पिक)', '(optional)'),
    bdayGift: T("Add your birthday and we'll have a gift waiting: {gift}.", 'अपना जन्मदिन डालें, आपके लिए गिफ़्ट तैयार रहेगा: {gift}।', 'Apna birthday daalo, aapke liye gift ready rahega: {gift}.'),
    day: T('Day', 'तारीख़', 'Din'),
    month: T('Month', 'महीना', 'Mahina'),
    bdayOnce: T('🔒 You can set this once. Wrong date later? Ask the cafe to fix it.', '🔒 यह एक ही बार डाल सकते हैं। तारीख़ गलत हो तो कैफ़े से ठीक करवाएँ।', '🔒 Ye ek hi baar daal sakte ho. Date galat ho to cafe se theek karwao.'),
    wait: T('Please wait...', 'रुकिए...', 'Ruko...'),
    continue: T('Continue', 'आगे बढ़ें', 'Aage badho'),
};

// First visit (e.g. after scanning the table QR): name + mobile, no OTP.
// The same mobile on another phone opens the same customer account.
const QuickLoginForm = ({ title, titleClassName = 'modal-title', subtitleClassName = 'modal-subtitle', onSuccess }) => {
    const { lang, t } = useCxLang();
    const { customerSignIn } = useAuth();
    const months = MONTHS[lang] || MONTHS.en;
    // Default title, or the plain "Welcome!" the Login page passes: both follow the customer's language
    const heading = title == null ? `${t(W.welcome)} 👋` : title === 'Welcome!' ? t(W.welcome) : title;
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
        if (!name.trim()) return setError(t(W.enterName));
        if (!/^[6-9]\d{9}$/.test(phone)) return setError(t(W.enterMobile));
        if (bday.day && bday.month && Number(bday.day) > new Date(2000, Number(bday.month), 0).getDate()) {
            return setError(t(W.monthDays, { month: months[bday.month - 1], n: new Date(2000, Number(bday.month), 0).getDate() }));
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
            setError(err.response?.data?.message || t(W.signInFailed));
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <p className={titleClassName}>{heading}</p>
            <p className={subtitleClassName}>{t(W.subtitle)}</p>
            <div style={{ margin: '0 0 14px' }}>
                <small className="muted" style={{ display: 'block', marginBottom: 6 }}>Language · भाषा</small>
                <LangChips />
            </div>

            <div className="profile-fields">
                <div className="input-group">
                    <label>{t(W.name)} <span className="required">*</span></label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t(W.namePh)}
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
                    placeholder={t(W.mobilePh)}
                    className="phone-input"
                    autoComplete="tel-national"
                />
            </div>

            {club?.askBirthday && (
                <div className="cl-ask" style={{ margin: '4px 0 12px' }}>
                    <p><b><span className="cl-cake" aria-hidden="true" style={{ display: 'inline-block', fontSize: '1.1rem' }}>🎁</span> {t(W.bdayAsk)}</b> <small>{t(W.optional)}</small>
                        {club.birthdayGift ? <><br /><small>{t(W.bdayGift, { gift: sayReward(club.birthdayGift, lang) })}</small></> : null}</p>
                    <div className="cl-dob">
                        <label htmlFor="qb-day">{t(W.day)}
                            <select id="qb-day" value={bday.day} onChange={e => setBday({ ...bday, day: e.target.value })}>
                                <option value="">{t(W.day)}</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                            </select></label>
                        <label htmlFor="qb-month">{t(W.month)}
                            <select id="qb-month" value={bday.month} onChange={e => setBday({ ...bday, month: e.target.value })}>
                                <option value="">{t(W.month)}</option>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                            </select></label>
                    </div>
                    <p className="cl-small muted">{t(W.bdayOnce)}</p>
                </div>
            )}

            {error && <p className="error-message">{error}</p>}

            <button type="submit" className="btn btn-primary btn-full" disabled={loading || !valid || bdayHalf}>
                {loading ? t(W.wait) : t(W.continue)}
            </button>
        </form>
    );
};

export default QuickLoginForm;
