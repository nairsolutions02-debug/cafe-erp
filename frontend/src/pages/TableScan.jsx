import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiMapPin, FiAlertCircle } from 'react-icons/fi';
import { resolveTable, moveMyTable, getCheckoutInfo } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getQrTable, saveQrTable } from '../lib/qrTable';
import { useBrand } from '../context/BrandContext';
import './TableScan.css';

const MESSAGES = {
    unknown: ['This QR code isn\'t in use any more', 'Please ask the staff for help, or scan the QR on your table again.'],
    inactive: ['This table isn\'t in use right now', 'Please ask the staff to seat you at another table.'],
    no_tables: ['Order at the counter', 'This café doesn\'t take orders to tables. Browse the menu and order for pickup.'],
};

// Landing page for a table QR (/t/5-K7Q2): remembers the table, then opens the menu
const TableScan = () => {
    const brand = useBrand();
    const { code } = useParams();
    const navigate = useNavigate();
    const { isAuthenticated, isAdmin } = useAuth();
    const [state, setState] = useState({ step: 'loading' });

    useEffect(() => {
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
                setState({ step: 'welcome', table: r });
            } catch {
                if (!cancelled) setState({ step: 'error', reason: 'unknown' });
            }
        })();
        return () => { cancelled = true; };
    }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (state.step !== 'welcome') return undefined;
        const t = setTimeout(() => navigate('/menu', { replace: true }), 1800);
        return () => clearTimeout(t);
    }, [state.step, navigate]);

    const move = async (yes) => {
        const t = state.table;
        if (yes) {
            try { await moveMyTable(t.code); } catch (e) { alert(e.response?.data?.message || e.message || 'Could not move your order, please ask the staff'); return; }
            saveQrTable(t);
        }
        navigate('/menu', { replace: true });
    };

    return (
        <div className="table-scan">
            <img src={brand.logo} alt={brand.name} className="ts-logo" />
            {state.step === 'loading' && <div className="spinner" />}
            {state.step === 'welcome' && (
                <div className="ts-card ts-pop">
                    <div className="ts-pin"><FiMapPin /></div>
                    <p className="ts-kicker">Welcome to {brand.name}</p>
                    <h1>You're at Table {state.table.tableNumber}</h1>
                    <p>Order from your phone. Friends at your table can scan too, and everyone gets their own bill.</p>
                    <button className="btn btn-primary btn-full" onClick={() => navigate('/menu', { replace: true })}>See the menu</button>
                </div>
            )}
            {state.step === 'move' && (
                <div className="ts-card ts-pop">
                    <div className="ts-pin"><FiMapPin /></div>
                    <h1>Move to Table {state.table.tableNumber}?</h1>
                    <p>Your open order is at Table {state.from}. Move it here so the staff bring it to the right table.</p>
                    <button className="btn btn-primary btn-full" onClick={() => move(true)}>Yes, move to Table {state.table.tableNumber}</button>
                    <button className="btn btn-ghost btn-full" onClick={() => move(false)}>No, I'm still at Table {state.from}</button>
                </div>
            )}
            {state.step === 'error' && (
                <div className="ts-card">
                    <div className="ts-pin warn"><FiAlertCircle /></div>
                    <h1>{state.reason === 'inactive' && state.tableNumber ? `Table ${state.tableNumber} isn't in use right now` : (MESSAGES[state.reason] || MESSAGES.unknown)[0]}</h1>
                    <p>{(MESSAGES[state.reason] || MESSAGES.unknown)[1]}{state.mode === 'pick' && state.reason !== 'no_tables' ? ' You can also pick your table at checkout.' : ''}</p>
                    <button className="btn btn-primary btn-full" onClick={() => navigate('/menu', { replace: true })}>Browse the menu</button>
                </div>
            )}
        </div>
    );
};

export default TableScan;
