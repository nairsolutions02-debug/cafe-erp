import React, { useState } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiPhone } from 'react-icons/fi';
import { saveVendor, deleteVendor } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from './Modal';
import { errorText, fmtDate, fmtMoney, whatsappLink } from './shared';

const blank = { name: '', phone: '', gstin: '', address: '', leadTimeDays: 1, orderCycleDays: 7, paymentTermsDays: 0, notes: '', isActive: true };

const VendorForm = ({ vendor, onClose, onSaved }) => {
    const [form, setForm] = useState(vendor ? { ...blank, ...vendor } : blank);
    const [error, setError] = useState('');
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const submit = async (e) => {
        e.preventDefault();
        try {
            const { id, name, phone, gstin, address, leadTimeDays, orderCycleDays, paymentTermsDays, notes, isActive } = form;
            await saveVendor({ id, name: name.trim(), phone, gstin: gstin.toUpperCase(), address, leadTimeDays, orderCycleDays, paymentTermsDays, notes, isActive });
            onSaved();
        } catch (err) {
            setError(errorText(err, 'Could not save vendor'));
        }
    };
    return (
        <Modal title={vendor ? `Edit ${vendor.name}` : 'Add vendor'} onClose={onClose} wide>
            <form onSubmit={submit}>
                <div className="modal-body form-grid">
                    <div className="input-group">
                        <label>Name *</label>
                        <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
                    </div>
                    <div className="input-group">
                        <label>Phone / WhatsApp</label>
                        <input className="input" inputMode="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
                    </div>
                    <div className="input-group">
                        <label>GSTIN</label>
                        <input className="input" value={form.gstin} onChange={e => set('gstin', e.target.value)} />
                    </div>
                    <div className="input-group">
                        <label>Address</label>
                        <input className="input" value={form.address} onChange={e => set('address', e.target.value)} />
                    </div>
                    <div className="input-group">
                        <label>Lead time (days) <span className="hint">order today, arrives in</span></label>
                        <input className="input" type="number" min="0" max="60" value={form.leadTimeDays} onChange={e => set('leadTimeDays', e.target.value)} />
                    </div>
                    <div className="input-group">
                        <label>Orders every (days) <span className="hint">how long one order should last</span></label>
                        <input className="input" type="number" min="1" max="90" value={form.orderCycleDays} onChange={e => set('orderCycleDays', e.target.value)} />
                    </div>
                    <div className="input-group">
                        <label>Payment terms (days)</label>
                        <select className="input" value={form.paymentTermsDays} onChange={e => set('paymentTermsDays', e.target.value)}>
                            {[0, 7, 15, 30, 45].map(d => <option key={d} value={d}>{d === 0 ? 'Cash on delivery' : `${d} days`}</option>)}
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Notes</label>
                        <input className="input" value={form.notes} onChange={e => set('notes', e.target.value)} />
                    </div>
                    {vendor && (
                        <label className="check span-2"><input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} /> Active</label>
                    )}
                    {error && <p className="error-message span-2">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save</button>
                </div>
            </form>
        </Modal>
    );
};

const VendorsTab = ({ vendors, reloadVendors, q }) => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const [modal, setModal] = useState(null);
    const [search, setSearch] = useState(q);
    const saved = () => { setModal(null); reloadVendors(); };
    const remove = async (v) => {
        if (!window.confirm(`Delete vendor "${v.name}"? Past purchases keep the vendor's name.`)) return;
        try {
            await deleteVendor(v.id);
            reloadVendors();
        } catch (err) {
            alert(errorText(err, 'Could not delete'));
        }
    };
    const shown = vendors.filter(v => !search || v.name.toLowerCase().includes(search.toLowerCase()) || (v.phone || '').includes(search));

    return (
        <div>
            <div className="inv-toolbar">
                <input className="input search" placeholder="Search vendors…" value={search} onChange={e => setSearch(e.target.value)} />
                <div className="spacer" />
                {hasPerm('inventory.create') && <button className="btn btn-primary" onClick={() => setModal({})}><FiPlus /> Add vendor</button>}
            </div>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead>
                        <tr><th>Vendor</th><th>Phone</th><th>Lead time</th><th>Order cycle</th><th>Terms</th><th>Items</th><th>Last bill</th>{seeCost && <th>To pay</th>}<th aria-label="Actions" /></tr>
                    </thead>
                    <tbody>
                        {shown.map(v => (
                            <tr key={v.id} className={v.isActive ? '' : 'inactive'}>
                                <td><strong>{v.name}</strong>{v.gstin && <div className="muted small">{v.gstin}</div>}</td>
                                <td>{v.phone ? (
                                    <span className="row-actions start">
                                        <a href={`tel:${v.phone}`} className="link-btn"><FiPhone /> {v.phone}</a>
                                        <a href={whatsappLink(v.phone, '')} target="_blank" rel="noopener noreferrer" className="link-btn">WhatsApp</a>
                                    </span>) : '—'}</td>
                                <td>{v.leadTimeDays} d</td>
                                <td>{v.orderCycleDays} d</td>
                                <td>{v.paymentTermsDays ? `${v.paymentTermsDays} d` : 'Cash'}</td>
                                <td>{v.items}</td>
                                <td>{v.lastPurchase ? fmtDate(v.lastPurchase) : '—'}</td>
                                {seeCost && <td className={v.due > 0 ? 'neg' : ''}>{v.due > 0 ? fmtMoney(v.due) : '—'}</td>}
                                <td>
                                    <span className="row-actions">
                                        {hasPerm('inventory.edit') && <button className="icon-btn" aria-label={`Edit ${v.name}`} onClick={() => setModal({ vendor: v })}><FiEdit2 /></button>}
                                        {hasPerm('inventory.delete') && <button className="icon-btn delete" aria-label={`Delete ${v.name}`} onClick={() => remove(v)}><FiTrash2 /></button>}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {shown.length === 0 && <tr><td colSpan={9} className="empty muted">No vendors yet. Add the dairy, coffee and grocery suppliers with their delivery lead time.</td></tr>}
                    </tbody>
                </table>
            </div>
            {modal && <VendorForm vendor={modal.vendor} onClose={() => setModal(null)} onSaved={saved} />}
        </div>
    );
};

export default VendorsTab;
