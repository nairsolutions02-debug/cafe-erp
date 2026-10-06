import React, { useEffect, useState } from 'react';
import { FiUser, FiGift, FiLock, FiChevronLeft, FiChevronDown } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import { getClubPublicConfig, setMyBirthday } from '../utils/api';
import useCxLang, { T, sayReward } from '../lib/cxLang';
import { readMe, maskPhone } from '../lib/cxMe';
import { LangChips } from './cx/LangPicker';
import './cx/Journey.css';

const MONTHS = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};
const W = {
    welcome: T('Welcome to {name}', '{name} में आपका स्वागत है', '{name} mein swagat hai'),
    subtitle: T('One step, no OTP, no password.', 'बस एक कदम। न OTP, न पासवर्ड।', 'Bas ek step. Na OTP, na password.'),
    name: T('Your name', 'आपका नाम', 'Aapka naam'),
    mobile: T('Mobile number', 'मोबाइल नंबर', 'Mobile number'),
    enterName: T('Please enter your name', 'कृपया अपना नाम लिखें', 'Please apna naam likho'),
    enterMobile: T('Please enter a valid 10-digit mobile number', 'कृपया सही 10 अंकों का मोबाइल नंबर लिखें', 'Please sahi 10-digit mobile number likho'),
    monthDays: T('{month} has only {n} days', '{month} में सिर्फ़ {n} दिन होते हैं', '{month} mein sirf {n} din hote hain'),
    signInFailed: T('Could not sign in. Please try again.', 'साइन इन नहीं हो पाया। फिर से कोशिश करें।', 'Sign in nahi ho paya. Phir se try karo.'),
    bday: T('Birthday', 'जन्मदिन', 'Birthday'),
    optional: T('(optional)', '(वैकल्पिक)', '(optional)'),
    bdayGift: T("Add your birthday and we'll have a gift waiting: {gift}.", 'अपना जन्मदिन डालें, आपके लिए गिफ़्ट तैयार रहेगा: {gift}।', 'Apna birthday daalo, aapke liye gift ready rahega: {gift}.'),
    bdaySurprise: T('Free gift', 'मुफ़्त गिफ़्ट', 'Free gift'),
    day: T('Day', 'तारीख़', 'Din'),
    month: T('Month', 'महीना', 'Mahina'),
    bdayOnce: T('You can set this once. Wrong date later? Ask the cafe to fix it.', 'यह एक ही बार डाल सकते हैं। तारीख़ गलत हो तो कैफ़े से ठीक करवाएँ।', 'Ye ek hi baar daal sakte ho. Date galat ho to cafe se theek karwao.'),
    stayTitle: T('You stay signed in on this phone.', 'इस फ़ोन पर आप साइन इन रहेंगे।', 'Is phone pe aap signed in rahoge.'),
    stayText: T('Next time you scan any table QR, even months later, you land straight on your home page.',
        'अगली बार किसी भी टेबल का QR स्कैन करें, महीनों बाद भी, सीधे आपका होम पेज खुलेगा।',
        'Agli baar kisi bhi table ka QR scan karo, mahino baad bhi, seedha aapka home page khulega.'),
    wait: T('Please wait...', 'रुकिए...', 'Ruko...'),
    continue: T('Continue', 'आगे बढ़ें', 'Aage badho'),
    sameNumber: T('Same number on a new phone opens the same account, points and favourites.',
        'नए फ़ोन पर यही नंबर डालें, वही अकाउंट, पॉइंट और पसंदीदा मिलेंगे।',
        'Naye phone pe yahi number daalo, wahi account, points aur favourites milenge.'),
    againTitle: T('Welcome back, {name}?', 'फिर से स्वागत है, {name}?', 'Welcome back, {name}?'),
    againText: T('Tap Continue to sign in again. No OTP, no typing.', 'फिर से साइन इन करने के लिए आगे बढ़ें दबाएँ। न OTP, न टाइपिंग।', 'Dobara sign in ke liye Continue dabao. Na OTP, na typing.'),
    notYou: T('Not you? Use another number', 'आप नहीं हैं? दूसरा नंबर डालें', 'Aap nahi ho? Doosra number daalo'),
    back: T('Back', 'वापस', 'Wapas'),
};

// The brand's logo in a rounded tile, or the first letter of the cafe name when no logo was uploaded
export const AppIcon = ({ brand, size = 64 }) => (
    <div className="cxj-appic" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
        {brand.logoIsCustom && brand.logo ? <img src={brand.logo} alt="" /> : (brand.name || 'C').trim().charAt(0).toUpperCase()}
    </div>
);

// Sign in once: name + mobile, no OTP. The same mobile on another phone opens the same customer account.
// When this phone remembers the customer (lost session), it offers a one-tap "Welcome back, <name>?" instead.
const QuickLoginForm = ({ onSuccess, onBack, showLang = true }) => {
    const { lang, t } = useCxLang();
    const brand = useBrand();
    const { customerSignIn } = useAuth();
    const months = MONTHS[lang] || MONTHS.en;
    const [saved] = useState(readMe);
    const [again, setAgain] = useState(!!saved);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    // Optional birthday (day and month), when the cafe asks for it
    const [club, setClub] = useState(null);
    const [bdayOpen, setBdayOpen] = useState(false);
    const [bday, setBday] = useState({ day: '', month: '' });
    useEffect(() => { getClubPublicConfig().then(r => setClub(r.data)).catch(() => {}); }, []);
    const bdayHalf = (bday.day && !bday.month) || (!bday.day && bday.month);

    const valid = name.trim().length > 0 && /^[6-9]\d{9}$/.test(phone);

    const signInAgain = async () => {
        setLoading(true);
        setError('');
        try {
            await customerSignIn(saved.name, saved.phone);
            onSuccess?.({ returning: true });
        } catch (err) {
            setError(err.response?.data?.message || t(W.signInFailed));
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (again) return signInAgain();
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
            onSuccess?.({ returning: false });
        } catch (err) {
            setError(err.response?.data?.message || t(W.signInFailed));
        } finally {
            setLoading(false);
        }
    };

    const gift = club?.birthdayGift ? sayReward(club.birthdayGift, lang) : '';

    return (
        <form className="cxj-signin" onSubmit={handleSubmit} noValidate>
            <div className="cxj-signin-top">
                {onBack ? (
                    <button type="button" className="cxj-ib cx-glass" onClick={onBack} aria-label={t(W.back)}><FiChevronLeft /></button>
                ) : <span />}
                {showLang && <LangChips className="cxj-lang-mini" />}
            </div>

            {again ? (
                <>
                    <div className="cxj-signin-head">
                        <div className="cxj-av cxj-av-lg" aria-hidden="true">{saved.name.charAt(0).toUpperCase()}</div>
                        <h1 className="cxj-h">{t(W.againTitle, { name: saved.name })}</h1>
                        <p className="cxj-mu">{t(W.againText)}</p>
                    </div>
                    <div className="cxj-field cx-glass cxj-field-static">
                        <FiUser aria-hidden="true" /><span>{saved.name}</span>
                    </div>
                    <div className="cxj-field cx-glass cxj-field-static">
                        <span className="cxj-pfx">+91</span><span>{maskPhone(saved.phone)}</span>
                    </div>
                    {error && <p className="cxj-error" role="alert">{error}</p>}
                    <button type="submit" className="cxj-btn" disabled={loading}>{loading ? t(W.wait) : t(W.continue)}</button>
                    <button type="button" className="cxj-later" onClick={() => { setAgain(false); setError(''); }}>{t(W.notYou)}</button>
                </>
            ) : (
                <>
                    <div className="cxj-signin-head">
                        <AppIcon brand={brand} />
                        <h1 className="cxj-h">{t(W.welcome, { name: brand.name })}</h1>
                        <p className="cxj-mu">{t(W.subtitle)}</p>
                    </div>

                    <label className="cxj-field cx-glass">
                        <FiUser aria-hidden="true" />
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t(W.name)}
                            aria-label={t(W.name)} autoComplete="name" autoFocus required />
                    </label>

                    <label className="cxj-field cx-glass">
                        <span className="cxj-pfx">+91</span>
                        <input type="tel" inputMode="numeric" value={phone} aria-label={t(W.mobile)}
                            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                            placeholder={t(W.mobile)} autoComplete="tel-national" />
                    </label>

                    {club?.askBirthday && (
                        <div className={`cxj-bday cx-glass ${bdayOpen ? 'open' : ''}`}>
                            <button type="button" className="cxj-bday-row" aria-expanded={bdayOpen} onClick={() => setBdayOpen(o => !o)}>
                                <FiGift aria-hidden="true" />
                                <span className="cxj-mu cxj-grow">{t(W.bday)} {t(W.optional)}</span>
                                <b className="cxj-gift">{gift && gift.length <= 22 ? gift : t(W.bdaySurprise)}</b>
                                <FiChevronDown className="cxj-chev" aria-hidden="true" />
                            </button>
                            {bdayOpen && (
                                <div className="cxj-bday-body">
                                    {gift && <p className="cxj-mu cxj-small">{t(W.bdayGift, { gift })}</p>}
                                    <div className="cxj-dob">
                                        <label htmlFor="qb-day">{t(W.day)}
                                            <select id="qb-day" value={bday.day} onChange={e => setBday({ ...bday, day: e.target.value })}>
                                                <option value="">{t(W.day)}</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                                            </select></label>
                                        <label htmlFor="qb-month">{t(W.month)}
                                            <select id="qb-month" value={bday.month} onChange={e => setBday({ ...bday, month: e.target.value })}>
                                                <option value="">{t(W.month)}</option>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                                            </select></label>
                                    </div>
                                    <p className="cxj-mu cxj-small"><FiLock aria-hidden="true" /> {t(W.bdayOnce)}</p>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="cxj-note cx-glass">
                        <FiLock aria-hidden="true" />
                        <span><b>{t(W.stayTitle)}</b> {t(W.stayText)}</span>
                    </div>

                    {error && <p className="cxj-error" role="alert">{error}</p>}

                    <button type="submit" className="cxj-btn" disabled={loading || !valid || bdayHalf}>
                        {loading ? t(W.wait) : t(W.continue)}
                    </button>
                    <p className="cxj-mu cxj-foot">{t(W.sameNumber)}</p>
                </>
            )}
        </form>
    );
};

export default QuickLoginForm;
