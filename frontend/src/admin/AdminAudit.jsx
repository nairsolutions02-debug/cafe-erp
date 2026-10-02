import React, { useEffect, useState } from 'react';
import { getAuditLog } from '../utils/api';
import './AdminStaff.css';
import './AdminAudit.css';

const ENTITIES = [
    ['', 'Everything'], ['menu_items', 'Menu items'], ['categories', 'Categories'], ['orders', 'Orders'],
    ['settings', 'Settings'], ['coupons', 'Coupons'], ['loyalty_settings', 'Loyalty settings'],
    ['loyalty_offers', 'Loyalty offers'], ['staff_users', 'Staff'], ['roles', 'Roles'],
    ['role_permissions', 'Role permissions'], ['staff_overrides', 'Staff exceptions'], ['employees', 'Employees'],
];
const ACTION_LABEL = { insert: 'Added', update: 'Changed', delete: 'Deleted' };
const IGNORED = new Set(['updated_at', 'created_at', 'tenant_id', 'id', 'failed_attempts', 'last_login_at', 'locked_until']);

// Only the fields that changed, "price: 100 → 110"
const describeChange = (row) => {
    if (row.action !== 'update' || !row.oldData || !row.newData) return '';
    return Object.keys(row.newData)
        .filter(k => !IGNORED.has(k) && JSON.stringify(row.oldData[k]) !== JSON.stringify(row.newData[k]))
        .map(k => `${k.replace(/_/g, ' ')}: ${JSON.stringify(row.oldData[k])} → ${JSON.stringify(row.newData[k])}`)
        .join(' · ');
};

const AdminAudit = () => {
    const [entity, setEntity] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ rows: [], total: 0 });
    const [loading, setLoading] = useState(true);
    const limit = 50;

    useEffect(() => {
        setLoading(true);
        getAuditLog({ entity, page, limit }).then(r => setData(r.data)).finally(() => setLoading(false));
    }, [entity, page]);

    const pages = Math.max(1, Math.ceil(data.total / limit));

    return (
        <div className="admin-audit">
            <div className="page-header">
                <div>
                    <h1>Audit Log</h1>
                    <p className="muted">Every change to prices, menu, orders, settings, staff and permissions: who, what and when. Nobody can edit this list.</p>
                </div>
                <select className="input audit-filter" value={entity} onChange={e => { setEntity(e.target.value); setPage(1); }}>
                    {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
            </div>

            <div className="table-scroll">
                <table className="staff-table">
                    <thead>
                        <tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr>
                    </thead>
                    <tbody>
                        {data.rows.map(r => (
                            <tr key={r._id}>
                                <td className="nowrap">{new Date(r.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                                <td>{r.actorName}</td>
                                <td>
                                    <strong>{ACTION_LABEL[r.action] || r.action}</strong>{' '}
                                    {(ENTITIES.find(e => e[0] === r.entity)?.[1] || r.entity).toLowerCase()}
                                    {r.summary && <> · <em>{r.summary}</em></>}
                                </td>
                                <td className="audit-diff">{describeChange(r)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!loading && data.rows.length === 0 && <p className="muted empty">Nothing recorded yet.</p>}
            </div>

            {pages > 1 && (
                <div className="pager">
                    <button className="btn btn-ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
                    <span>Page {page} of {pages}</span>
                    <button className="btn btn-ghost" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
            )}
        </div>
    );
};

export default AdminAudit;
