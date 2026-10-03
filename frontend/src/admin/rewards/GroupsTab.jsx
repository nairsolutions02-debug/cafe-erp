import React, { useCallback, useEffect, useState } from 'react';
import { FiMessageCircle } from 'react-icons/fi';
import { getCustomerGroups } from '../../utils/api';
import { fmtDate, fmtMoney, whatsappLink } from '../inventory/shared';
import { GROUPS } from './RulesTab';

// Automatic groups; each list doubles as a WhatsApp to-do (e.g. message everyone who is slipping)
const GroupsTab = () => {
    const [group, setGroup] = useState('slipping');
    const [data, setData] = useState({ counts: {}, customers: [] });
    const [text, setText] = useState('Hi {name}, we miss you at the cafe! Come by this week for a treat ☕');
    const load = useCallback(async () => setData((await getCustomerGroups(group)).data), [group]);
    useEffect(() => { load(); }, [load]);
    return (
        <div>
            <div className="group-chips">
                {GROUPS.map(g => (
                    <button key={g.value} className={`group-chip${group === g.value ? ' on' : ''}`} onClick={() => setGroup(g.value)}>
                        <strong>{data.counts[g.value] || 0}</strong><span>{g.label}</span>
                    </button>
                ))}
            </div>
            <div className="input-group">
                <label>Message <span className="hint">{'{name}'} = first name</span></label>
                <textarea className="input" rows={2} value={text} onChange={e => setText(e.target.value)} />
            </div>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Customer</th><th>Orders</th><th>Spend</th><th>Last visit</th><th>Points</th><th aria-label="WhatsApp" /></tr></thead>
                    <tbody>{data.customers.map(c => (
                        <tr key={c.id}>
                            <td><strong>{c.name || 'Customer'}</strong><div className="muted small">{c.phone}</div></td>
                            <td>{c.orders}</td><td>{fmtMoney(c.spend, 0)}</td><td>{fmtDate(c.lastAt)}</td><td>{c.points}</td>
                            <td>{c.canWhatsapp && <a className="icon-btn" aria-label={`WhatsApp ${c.name}`} target="_blank" rel="noopener noreferrer"
                                href={whatsappLink(c.phone, text.replace(/\{name\}/g, (c.name || 'there').split(' ')[0]))}><FiMessageCircle /></a>}</td>
                        </tr>))}
                        {data.customers.length === 0 && <tr><td colSpan={6} className="muted">Nobody in this group.</td></tr>}</tbody>
                </table>
            </div>
            <p className="muted small">Groups update after every paid order and once a day. Use them in reward rules (Customer moves into a group → e.g. 20% off for Slipping).</p>
        </div>
    );
};

export default GroupsTab;
