import React, { useEffect, useRef, useState } from 'react';
import { FiCreditCard, FiPrinter, FiFileText, FiMove, FiUsers, FiX, FiAlertTriangle } from 'react-icons/fi';
import { inr } from '../pos/money';
import useMenuLang, { tableToken } from './useMenuLang';
import { W } from './staffText';
import './PhoneOrders.css';

const CHANNEL = { qr: 'QR', dine_in: 'Dine-in', takeaway: 'Takeaway', kiosk: 'Kiosk', aggregator: 'Delivery', counter: 'Counter' };
const due = (o) => Math.max(0, Math.round((o.total - (o.amountPaid || 0)) * 100) / 100);
const mins = (o) => Math.max(0, Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000));
const ageCls = (m) => (m >= 15 ? 'late' : m >= 8 ? 'warn' : '');
const tokenOf = (o) => (o.tableNumber ? tableToken(o.tableNumber) : o.tokenNumber || o.orderNumber.slice(-4));
const NEXT_WORD = { pending: 'confirm', confirmed: 'start', preparing: 'markReady', ready: 'served', bill_requested: 'makeBill' };

const FILTERS = [
    ['action', 'action', (o) => o.held || o.status === 'pending' || o.status === 'bill_requested' || !!o.paymentRequest],
    ['cooking', 'cooking', (o) => !o.held && (o.status === 'confirmed' || o.status === 'preparing')],
    ['ready', 'ready', (o) => o.status === 'ready'],
    ['unpaid', 'unpaid', (o) => due(o) > 0],
    ['all', 'all', () => true],
];

// Phone layout of the Orders page: chips with counts, compact cards with one main button,
// swipe right for the next step, everything else in a sheet from the bottom.
const PhoneOrders = ({ orders, canEdit, canMoney, hasNext, onNext, onPay, onCancel, onMove, onBill, onKot, onPrint, groupsAtTable }) => {
    const { t } = useMenuLang();
    const [filter, setFilter] = useState(null);
    const [sheet, setSheet] = useState(null);
    const [, tick] = useState(0);
    useEffect(() => { const t = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(t); }, []);

    const counts = Object.fromEntries(FILTERS.map(([k, , fn]) => [k, orders.filter(fn).length]));
    const view = filter || (counts.action > 0 ? 'action' : 'all');
    const fn = FILTERS.find(([k]) => k === view)[2];
    const list = orders.filter(fn).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const open = sheet && orders.find(o => o._id === sheet);

    // The one next step for a card, or null
    const main = (o) => {
        if (o.held) return canMoney ? { label: t(o.holdReason === 'accept' ? W.accept : W.confirmTable), run: () => onNext(o), swipe: true } : null;
        // Kitchen steps (start, ready, served) need orders.edit; accepting and billing need orders.create
        const kitchenStep = ['confirmed', 'preparing', 'ready'].includes(o.status);
        if (hasNext(o) && NEXT_WORD[o.status] && (kitchenStep ? canEdit : canMoney)) {
            return { label: t(W[NEXT_WORD[o.status]]), run: () => onNext(o), swipe: o.status !== 'bill_requested', tone: o.status === 'preparing' ? 'ok' : o.status === 'ready' ? 'ghost' : '' };
        }
        if (canMoney && due(o) > 0) return { label: `${t(W.takePayment)} · ${inr(due(o))}`, run: () => onPay(o), tone: 'pay' };
        return null;
    };

    return (
        <div className="po">
            <div className="po-chips" role="group" aria-label="Filter orders">
                {FILTERS.map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={view === k} className={k === 'action' && counts.action ? 'hot' : ''} onClick={() => setFilter(k)}>
                        {t(W[label])}<span>{counts[k]}</span>
                    </button>
                ))}
            </div>

            {list.length === 0 ? (
                <div className="po-empty"><span aria-hidden="true">☕</span>{t(view === 'all' ? W.noOrders : W.allClear)}</div>
            ) : (
                <>
                    {canEdit && <p className="po-hint">{t(W.hint)}</p>}
                    {list.map(o => <Card key={o._id} o={o} t={t} step={main(o)} onOpen={() => setSheet(o._id)} groups={groupsAtTable(o)} />)}
                </>
            )}

            {open && (
                <Sheet o={open} t={t} step={main(open)} canEdit={canMoney} groups={groupsAtTable(open)} onClose={() => setSheet(null)}
                    act={(f) => { setSheet(null); f(open); }} onPay={onPay} onCancel={onCancel} onMove={onMove} onBill={onBill} onKot={onKot} onPrint={onPrint} />
            )}
        </div>
    );
};

const Card = ({ o, t, step, onOpen, groups }) => {
    const ref = useRef(null);
    const drag = useRef(null);
    const [dx, setDx] = useState(0);
    const m = mins(o);
    const items = o.items.map(i => `${i.quantity}× ${i.name}`).join(', ');
    const paid = due(o) === 0;

    const down = (e) => { if (step?.swipe && !e.target.closest('button')) drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
    const move = (e) => {
        const d = drag.current; if (!d) return;
        const x = e.clientX - d.x; const y = e.clientY - d.y;
        if (!d.moved) {
            if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
            if (Math.abs(y) > Math.abs(x)) { drag.current = null; return; }
            d.moved = true;
        }
        setDx(Math.max(0, Math.min(150, x)));
    };
    const up = () => {
        const d = drag.current; drag.current = null;
        if (d?.moved && dx > 90) step.run();
        if (d?.moved) ref.current.dataset.swiped = '1';
        setDx(0);
    };
    const click = (e) => {
        if (ref.current.dataset.swiped) { delete ref.current.dataset.swiped; return; }
        if (!e.target.closest('button')) onOpen();
    };

    return (
        <div className={`po-card${o.held ? ' held' : ''} s-${o.status}`}>
            {step?.swipe && <div className="po-swipe" aria-hidden="true">✓ {step.label}</div>}
            <div ref={ref} className={`po-in${dx ? ' drag' : ''}`} style={dx ? { transform: `translateX(${dx}px)` } : undefined}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click}
                role="button" tabIndex={0} aria-label={`Order ${o.orderNumber}, open details`} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
                <span className="po-tok"><b>{tokenOf(o)}</b><small>{o.tableNumber ? (CHANNEL[o.channel] || 'QR') : (CHANNEL[o.channel] || '').slice(0, 9)}</small></span>
                <span className="po-top">
                    <span className="po-who">{o.user?.name || (o.tableNumber ? `${t(W.table)} ${o.tableNumber}` : t(W.walkIn))}</span>
                    <span className={`po-age ${ageCls(m)}`}>{m}m</span>
                </span>
                <span className="po-items">{items}</span>
                <span className="po-foot">
                    {o.held ? <span className="po-tag held">{t(W.waitingStaff)}</span>
                        : <span className="po-tag">{t(W.status[o.status]) || o.status.replace('_', ' ')}</span>}
                    {groups > 1 && <span className="po-tag"><FiUsers /> {groups}</span>}
                    {o.paymentRequest && <span className="po-tag pay">{t(o.paymentRequest === 'qr' ? W.wantsUpi : W.payingCounter)}</span>}
                    <span className={`po-tag ${paid ? 'paid' : 'unpaid'}`}>{t(paid ? W.paid : W.unpaid)}</span>
                    <span className="po-amt">{inr(o.total)}</span>
                </span>
                {step && <button type="button" className={`po-act ${step.tone || ''}`} onClick={step.run}>{step.label}</button>}
            </div>
        </div>
    );
};

const Sheet = ({ o, t, step, canEdit, groups, onClose, act, onPay, onCancel, onMove, onBill, onKot, onPrint }) => {
    useEffect(() => {
        const esc = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onClose]);
    return (
        <>
            <div className="po-scrim" onClick={onClose} aria-hidden="true" />
            <div className="po-sheet sheet" role="dialog" aria-modal="true" aria-label={`Order ${o.orderNumber}`}>
                <div className="po-grab" aria-hidden="true" />
                <div className="po-sh-head">
                    <span className="po-tok"><b>{tokenOf(o)}</b><small>{CHANNEL[o.channel] || 'QR'}</small></span>
                    <span className="po-sh-who">
                        <b>{o.user?.name || (o.tableNumber ? `${t(W.table)} ${o.tableNumber}` : t(W.walkIn))}</b>
                        <small>{o.orderNumber} · {mins(o)} {t(W.minAgo)}{o.user?.phone ? ` · ${o.user.phone}` : ''}{o.staffName ? ` · ${o.staffName}` : ''}</small>
                    </span>
                    <button type="button" className="po-x" aria-label="Close" onClick={onClose}><FiX /></button>
                </div>
                {o.held && <p className="po-note">{t(o.holdReason === 'accept' ? W.acceptNote : W.heldNote)}</p>}
                {o.specialInstructions && <p className="po-note"><FiAlertTriangle /> {o.specialInstructions}</p>}
                <ul className="po-lines">
                    {o.items.map((i, n) => <li key={n}><span>{i.quantity}×</span><span>{i.name}</span><span>{i.price != null ? inr(i.price * i.quantity) : ''}</span></li>)}
                    <li className="tot"><span /><span>{t(W.total)}</span><span>{inr(o.total)}</span></li>
                    {o.amountPaid > 0 && <li><span /><span>{t(W.paid)}</span><span>{inr(o.amountPaid)}</span></li>}
                    {due(o) > 0 && <li className="due"><span /><span>{t(W.balance)}</span><span>{inr(due(o))}</span></li>}
                </ul>
                {step && <button type="button" className={`po-act ${step.tone || ''}`} onClick={() => { onClose(); step.run(); }}>{step.label}</button>}
                <div className="po-grid">
                    {canEdit && due(o) > 0 && step?.tone !== 'pay' && <button type="button" onClick={() => act(onPay)}><FiCreditCard /> {t(W.takePayment)}</button>}
                    <button type="button" onClick={() => act(onKot)}><FiPrinter /> {t(W.kot)}</button>
                    <button type="button" onClick={() => act(onPrint)}><FiPrinter /> {t(W.printBill)}</button>
                    <button type="button" onClick={() => act((x) => onBill(x, false))}><FiFileText /> {t(W.bill)}</button>
                    {groups > 1 && <button type="button" onClick={() => act((x) => onBill(x, true))}><FiUsers /> {t(W.wholeTable)}</button>}
                    {canEdit && o.channel !== 'kiosk' && <button type="button" onClick={() => act(onMove)}><FiMove /> {t(W.move)}</button>}
                </div>
                {canEdit && <button type="button" className="po-cancel" onClick={() => act(onCancel)}>{t(W.cancelOrder)}</button>}
            </div>
        </>
    );
};

export default PhoneOrders;
