import React, { useState } from 'react';
import { FiUser, FiLock, FiChevronLeft } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import useCxLang, { T } from '../lib/cxLang';
import { readMe, maskPhone } from '../lib/cxMe';
import { LangChips } from './cx/LangPicker';
import './cx/Journey.css';

const W = {
    welcome: T('Welcome to {name}', '{name} में आपका स्वागत है', '{name} mein swagat hai'),
    subtitle: T('Just your name and mobile number.', 'बस आपका नाम और मोबाइल नंबर।', 'Bas aapka naam aur mobile number.'),
    ownNumber: T('Please use your own number: your points, orders and bills are saved to it.',
        'कृपया अपना ही नंबर डालें: आपके पॉइंट, ऑर्डर और बिल इसी नंबर पर सेव होते हैं।',
        'Please apna hi number daalo: aapke points, orders aur bill isi number pe save hote hain.'),
    name: T('Your name', 'आपका नाम', 'Aapka naam'),
    mobile: T('Mobile number', 'मोबाइल नंबर', 'Mobile number'),
    enterName: T('Please enter your name', 'कृपया अपना नाम लिखें', 'Please apna naam likho'),
    enterMobile: T('Please enter a valid 10-digit mobile number', 'कृपया सही 10 अंकों का मोबाइल नंबर लिखें', 'Please sahi 10-digit mobile number likho'),
    signInFailed: T('Could not sign in. Please try again.', 'साइन इन नहीं हो पाया। फिर से कोशिश करें।', 'Sign in nahi ho paya. Phir se try karo.'),
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
    const { t } = useCxLang();
    const brand = useBrand();
    const { customerSignIn } = useAuth();
    const [saved] = useState(readMe);
    const [again, setAgain] = useState(!!saved);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

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

        setLoading(true);
        setError('');
        try {
            await customerSignIn(name.trim(), phone);
            onSuccess?.({ returning: false });
        } catch (err) {
            setError(err.response?.data?.message || t(W.signInFailed));
        } finally {
            setLoading(false);
        }
    };

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
                    <p className="cxj-numhint">{t(W.ownNumber)}</p>

                    <div className="cxj-note cx-glass">
                        <FiLock aria-hidden="true" />
                        <span><b>{t(W.stayTitle)}</b> {t(W.stayText)}</span>
                    </div>

                    {error && <p className="cxj-error" role="alert">{error}</p>}

                    <button type="submit" className="cxj-btn" disabled={loading || !valid}>
                        {loading ? t(W.wait) : t(W.continue)}
                    </button>
                    <p className="cxj-mu cxj-foot">{t(W.sameNumber)}</p>
                </>
            )}
        </form>
    );
};

export default QuickLoginForm;
