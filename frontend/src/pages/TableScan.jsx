import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiMapPin, FiAlertCircle } from 'react-icons/fi';
import { resolveTable, moveMyTable, getCheckoutInfo } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getQrTable, saveQrTable } from '../lib/qrTable';
import { useBrand } from '../context/BrandContext';
import './TableScan.css';
import useCxLang, { T } from '../lib/cxLang';
import { readMe } from '../lib/cxMe';
import Welcome from '../components/cx/Welcome';
import WelcomeBack from '../components/cx/WelcomeBack';
import QuickLoginForm from '../components/QuickLoginForm';

const MESSAGES = {
    unknown: [T('This QR code isn\'t in use any more', 'यह QR कोड अब काम नहीं करता', 'Yeh QR code ab kaam nahi karta'),
        T('Please ask the staff for help, or scan the QR on your table again.', 'कृपया स्टाफ़ से मदद लें, या अपनी टेबल का QR फिर से स्कैन करें।', 'Staff se help lo, ya apni table ka QR dobara scan karo.')],
    inactive: [T('This table isn\'t in use right now', 'यह टेबल अभी इस्तेमाल में नहीं है', 'Yeh table abhi use mein nahi hai'),
        T('Please ask the staff to seat you at another table.', 'कृपया स्टाफ़ से दूसरी टेबल पर बैठाने को कहें।', 'Staff se dusri table pe bithane ko bolo.')],
    no_tables: [T('Order at the counter', 'काउंटर पर ऑर्डर करें', 'Counter pe order karo'),
        T('This café doesn\'t take orders to tables. Browse the menu and order for pickup.', 'यह कैफ़े टेबल पर ऑर्डर नहीं लेता। मेन्यू देखें और ऑर्डर करके काउंटर से ले लें।', 'Yeh café table pe order nahi leta. Menu dekho aur order karke counter se le lo.')],
};

const W = {
    moveFailed: T('Could not move your order, please ask the staff', 'आपका ऑर्डर नहीं हट सका, कृपया स्टाफ़ से पूछें', 'Order move nahi ho paya, staff se pucho'),
    moveTitle: T('Move to Table {n}?', 'टेबल {n} पर जाएँ?', 'Table {n} pe shift karein?'),
    moveText: T('Your open order is at Table {from}. Move it here so the staff bring it to the right table.',
        'आपका चालू ऑर्डर टेबल {from} पर है। इसे यहाँ ले आएँ ताकि स्टाफ़ सही टेबल पर लाए।',
        'Aapka chalu order Table {from} pe hai. Isko yahan shift karo taaki staff sahi table pe laaye.'),
    moveYes: T('Yes, move to Table {n}', 'हाँ, टेबल {n} पर ले आएँ', 'Haan, Table {n} pe shift karo'),
    moveNo: T("No, I'm still at Table {from}", 'नहीं, मैं अभी भी टेबल {from} पर हूँ', 'Nahi, main abhi bhi Table {from} pe hoon'),
    tableOff: T("Table {n} isn't in use right now", 'टेबल {n} अभी इस्तेमाल में नहीं है', 'Table {n} abhi use mein nahi hai'),
    pickLater: T(' You can also pick your table at checkout.', ' आप पेमेंट के समय भी अपनी टेबल चुन सकते हैं।', ' Aap checkout pe bhi apni table choose kar sakte ho.'),
    browse: T('Browse the menu', 'मेन्यू देखें', 'Menu dekho'),
};

// Landing page for a table QR (/t/5-K7Q2): remembers the table, then
//   not signed in → Welcome (table, language) → sign in once → home
//   signed in     → "Welcome back, <name>" for a second → home
//   signed in once on this phone but the session was lost → one-tap "Welcome back, <name>?" → home
const TableScan = () => {
    const brand = useBrand();
    const { t } = useCxLang();
    const { code } = useParams();
    const navigate = useNavigate();
    const { isAuthenticated, isAdmin, isPlatform, loading } = useAuth();
    const [state, setState] = useState({ step: 'loading' });
    const goHome = () => navigate('/', { replace: true });

    useEffect(() => {
        // Wait until we know whether this phone is signed in (the move check and the welcome depend on it)
        if (loading) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const r = (await resolveTable(code)).data;
                if (cancelled) return;
                if (!r.ok) { setState({ step: 'error', reason: r.reason, mode: r.mode, tableNumber: r.tableNumber }); return; }
                // Already ordered at another table? Offer to move their open orders here
                const prev = getQrTable();
                if (isAuthenticated && !isAdmin && prev && prev.tableNumber !== r.tableNumber) {
                    const info = (await getCheckoutInfo()).data;
                    const open = (info?.openAtTable || []).filter(t => t.tableNumber !== r.tableNumber);
                    if (!cancelled && open.length) { setState({ step: 'move', table: r, from: open[0].tableNumber }); return; }
                }
                saveQrTable(r);
                const customer = isAuthenticated && !isAdmin && !isPlatform;
                setState({ step: customer ? 'back' : readMe() && !isAdmin && !isPlatform ? 'signin' : 'welcome', table: r });
            } catch {
                if (!cancelled) setState({ step: 'error', reason: 'unknown' });
            }
        })();
        return () => { cancelled = true; };
    }, [code, loading]); // eslint-disable-line react-hooks/exhaustive-deps

    const move = async (yes) => {
        const tb = state.table;
        if (yes) {
            try { await moveMyTable(tb.code); } catch (e) { alert(e.response?.data?.message || e.message || t(W.moveFailed)); return; }
            saveQrTable(tb);
        }
        // Moved (or staying at the old table): the usual welcome back, then home
        setState({ step: 'back', table: yes ? tb : { tableNumber: state.from } });
    };

    if (state.step === 'welcome') {
        return (
            <Welcome tableNumber={state.table.tableNumber} cafeName={brand.name}
                // A staff / admin session on this browser: the home page explains how to order as a customer
                onStart={() => (isAdmin || isPlatform ? goHome() : setState(s => ({ ...s, step: 'signin' })))} />
        );
    }
    if (state.step === 'signin') {
        return (
            <div className="cxj-page">
                <QuickLoginForm showLang={false}
                    onBack={() => setState(s => ({ ...s, step: 'welcome' }))}
                    onSuccess={({ returning } = {}) => (returning ? setState(s => ({ ...s, step: 'back' })) : goHome())} />
            </div>
        );
    }
    if (state.step === 'back') {
        return <WelcomeBack tableNumber={state.table?.tableNumber} onDone={goHome} />;
    }

    return (
        <div className="table-scan">
            <img src={brand.logo} alt={brand.name} className="ts-logo" />
            {state.step === 'loading' && <div className="spinner" />}
            {state.step === 'move' && (
                <div className="ts-card ts-pop">
                    <div className="ts-pin"><FiMapPin /></div>
                    <h1>{t(W.moveTitle, { n: state.table.tableNumber })}</h1>
                    <p>{t(W.moveText, { from: state.from })}</p>
                    <button className="btn btn-primary btn-full" onClick={() => move(true)}>{t(W.moveYes, { n: state.table.tableNumber })}</button>
                    <button className="btn btn-ghost btn-full" onClick={() => move(false)}>{t(W.moveNo, { from: state.from })}</button>
                </div>
            )}
            {state.step === 'error' && (
                <div className="ts-card">
                    <div className="ts-pin warn"><FiAlertCircle /></div>
                    <h1>{state.reason === 'inactive' && state.tableNumber ? t(W.tableOff, { n: state.tableNumber }) : t((MESSAGES[state.reason] || MESSAGES.unknown)[0])}</h1>
                    <p>{t((MESSAGES[state.reason] || MESSAGES.unknown)[1])}{state.mode === 'pick' && state.reason !== 'no_tables' ? t(W.pickLater) : ''}</p>
                    <button className="btn btn-primary btn-full" onClick={() => navigate('/menu', { replace: true })}>{t(W.browse)}</button>
                </div>
            )}
        </div>
    );
};

export default TableScan;
