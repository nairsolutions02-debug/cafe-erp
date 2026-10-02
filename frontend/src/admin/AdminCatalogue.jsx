import React, { useEffect, useState } from 'react';
import { FiPlus, FiTrash2, FiEdit2 } from 'react-icons/fi';
import { getBrands, createBrand, deleteBrand, getTaxGroups, saveTaxGroup, deleteTaxGroup, getSettings } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import './AdminStaff.css';
import './AdminCatalogue.css';

const errorText = (err, fallback) => err.response?.data?.message || fallback;

// Brands (Coca-Cola, Gold Flake…) and tax groups (Restaurant 5%, Packaged 18%, Tobacco 28%…)
const AdminCatalogue = () => {
    const { hasPerm } = useAuth();
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [defaultTax, setDefaultTax] = useState([]);
    const [brandName, setBrandName] = useState('');
    const [editing, setEditing] = useState(null);

    const load = async () => {
        const [b, g, s] = await Promise.all([getBrands(), getTaxGroups(), getSettings()]);
        setBrands(b.data);
        setGroups(g.data);
        setDefaultTax(Array.isArray(s.data.tax_config) ? s.data.tax_config : []);
    };
    useEffect(() => { load(); }, []);

    const addBrand = async (e) => {
        e.preventDefault();
        if (!brandName.trim()) return;
        try {
            await createBrand(brandName.trim());
            setBrandName('');
            load();
        } catch (err) {
            alert(errorText(err, 'Could not add brand'));
        }
    };

    const removeBrand = async (b) => {
        if (!window.confirm(`Delete brand "${b.name}"? Items keep working without a brand.`)) return;
        await deleteBrand(b._id);
        load();
    };

    const saveGroup = async (e) => {
        e.preventDefault();
        try {
            await saveTaxGroup({ id: editing._id, name: editing.name, components: editing.components.filter(c => c.name) });
            setEditing(null);
            load();
        } catch (err) {
            alert(errorText(err, 'Could not save tax group'));
        }
    };

    const removeGroup = async (g) => {
        if (!window.confirm(`Delete "${g.name}"? Items using it fall back to the cafe default tax.`)) return;
        await deleteTaxGroup(g._id);
        load();
    };

    const total = (comps) => comps.reduce((a, c) => a + (Number(c.rate) || 0), 0);

    return (
        <div className="admin-catalogue">
            <div className="page-header">
                <h1>Brands &amp; Taxes</h1>
            </div>

            <div className="catalogue-grid">
                <section className="panel">
                    <h2>Tax groups</h2>
                    <p className="muted">Each menu item can use its own tax group. Items without one use the cafe default:
                        <strong> {defaultTax.map(t => `${t.name} ${t.rate}%`).join(' + ') || 'not set'}</strong> (Settings).
                        Ask the cafe's CA to confirm each rate.</p>
                    <ul className="plain-list">
                        {groups.map(g => (
                            <li key={g._id}>
                                <div>
                                    <strong>{g.name}</strong>
                                    <span className="muted"> · {g.components.map(c => `${c.name} ${c.rate}%`).join(' + ')} = {total(g.components)}%</span>
                                </div>
                                {hasPerm('menu.edit') && (
                                    <span className="row-actions">
                                        <button className="icon-btn" aria-label="Edit" onClick={() => setEditing({ ...g, components: g.components.map(c => ({ ...c })) })}><FiEdit2 /></button>
                                        <button className="icon-btn delete" aria-label="Delete" onClick={() => removeGroup(g)}><FiTrash2 /></button>
                                    </span>
                                )}
                            </li>
                        ))}
                        {groups.length === 0 && <li className="muted">No tax groups yet. Add one for packaged goods or tobacco.</li>}
                    </ul>
                    {hasPerm('menu.create') && (
                        <button className="btn btn-ghost" onClick={() => setEditing({ name: '', components: [{ name: 'CGST', rate: 9 }, { name: 'SGST', rate: 9 }] })}>
                            <FiPlus /> Add tax group
                        </button>
                    )}
                </section>

                <section className="panel">
                    <h2>Brands</h2>
                    <p className="muted">Used to group and filter resale products (e.g. Coca-Cola, Gold Flake, Amul).</p>
                    <ul className="plain-list">
                        {brands.map(b => (
                            <li key={b._id}>
                                <strong>{b.name}</strong>
                                {hasPerm('menu.delete') && (
                                    <button className="icon-btn delete" aria-label="Delete" onClick={() => removeBrand(b)}><FiTrash2 /></button>
                                )}
                            </li>
                        ))}
                        {brands.length === 0 && <li className="muted">No brands yet.</li>}
                    </ul>
                    {hasPerm('menu.create') && (
                        <form className="inline-form" onSubmit={addBrand}>
                            <input className="input" value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="Brand name" />
                            <button className="btn btn-primary" type="submit"><FiPlus /> Add</button>
                        </form>
                    )}
                </section>
            </div>

            {editing && (
                <div className="modal-overlay" onClick={() => setEditing(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editing._id ? 'Edit tax group' : 'New tax group'}</h2>
                            <button className="modal-close" onClick={() => setEditing(null)}>×</button>
                        </div>
                        <form onSubmit={saveGroup}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label>Name *</label>
                                    <input className="input" value={editing.name} required placeholder="e.g. Packaged goods 18%"
                                        onChange={e => setEditing({ ...editing, name: e.target.value })} />
                                </div>
                                <label className="toggle-label">Components</label>
                                {editing.components.map((c, i) => (
                                    <div className="component-row" key={i}>
                                        <input className="input" value={c.name} placeholder="CGST"
                                            onChange={e => setEditing({ ...editing, components: editing.components.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                                        <input className="input" type="number" step="0.01" value={c.rate} placeholder="9"
                                            onChange={e => setEditing({ ...editing, components: editing.components.map((x, j) => j === i ? { ...x, rate: e.target.value } : x) })} />
                                        <span>%</span>
                                        <button type="button" className="icon-btn delete" aria-label="Remove"
                                            onClick={() => setEditing({ ...editing, components: editing.components.filter((_, j) => j !== i) })}><FiTrash2 /></button>
                                    </div>
                                ))}
                                <button type="button" className="btn btn-ghost" onClick={() => setEditing({ ...editing, components: [...editing.components, { name: 'Cess', rate: 0 }] })}>
                                    <FiPlus /> Add component
                                </button>
                                <p className="muted">Total: {total(editing.components)}%</p>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminCatalogue;
