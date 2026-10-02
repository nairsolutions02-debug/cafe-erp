import React, { useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { saveStockLocation, deleteStockLocation, setLocationDefault } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { errorText } from './shared';

// Stock locations: where purchases arrive and where sales take stock from by default.
// Categories and single menu items can point at another location (e.g. Kiosk) in Categories / Recipes.
const LocationsTab = ({ locations, reloadLocations }) => {
    const { hasPerm } = useAuth();
    const canEdit = hasPerm('inventory.edit');
    const [name, setName] = useState('');

    const run = async (fn, fallback) => {
        try {
            await fn();
            await reloadLocations();
        } catch (err) {
            alert(errorText(err, fallback));
        }
    };

    const add = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        run(async () => {
            await saveStockLocation({ name: name.trim(), sortOrder: locations.length + 1 });
            setName('');
        }, 'Could not add location');
    };
    const rename = (l) => {
        const n = window.prompt('Location name', l.name);
        if (n && n.trim() && n.trim() !== l.name) run(() => saveStockLocation({ id: l._id, name: n.trim() }), 'Could not rename');
    };

    return (
        <section className="panel locations">
            <h2>Stock locations</h2>
            <p className="muted">Purchases arrive at the purchase location. Sales take stock from the sales location unless the item's
                category or recipe says otherwise (e.g. the Kiosk category sells from the Kiosk).</p>
            <table className="staff-table">
                <thead><tr><th>Location</th><th>Purchases arrive here</th><th>Sales take from here</th><th>Active</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                    {locations.map(l => (
                        <tr key={l._id} className={l.isActive ? '' : 'inactive'}>
                            <td>{canEdit ? <button className="link-btn" onClick={() => rename(l)}>{l.name}</button> : <strong>{l.name}</strong>}</td>
                            <td><input type="radio" name="purchases" aria-label={`Purchases arrive at ${l.name}`} checked={l.receivesPurchases} disabled={!canEdit}
                                onChange={() => run(() => setLocationDefault(l._id, 'purchases'), 'Could not change')} /></td>
                            <td><input type="radio" name="sales" aria-label={`Sales take from ${l.name}`} checked={l.defaultForSales} disabled={!canEdit}
                                onChange={() => run(() => setLocationDefault(l._id, 'sales'), 'Could not change')} /></td>
                            <td>
                                <button className={`status-chip ${l.isActive ? 'on' : 'off'}`} disabled={!canEdit || l.receivesPurchases || l.defaultForSales}
                                    onClick={() => run(() => saveStockLocation({ id: l._id, isActive: !l.isActive }), 'Could not change')}>
                                    {l.isActive ? 'On' : 'Off'}
                                </button>
                            </td>
                            <td>{hasPerm('inventory.delete') && (
                                <button className="icon-btn delete" aria-label={`Delete ${l.name}`}
                                    onClick={() => window.confirm(`Delete "${l.name}"?`) && run(() => deleteStockLocation(l._id), 'Could not delete')}><FiTrash2 /></button>
                            )}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {hasPerm('inventory.create') && (
                <form className="inline-form" onSubmit={add} style={{ marginTop: 12 }}>
                    <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="New location, e.g. Bar" />
                    <button className="btn btn-primary" type="submit"><FiPlus /> Add</button>
                </form>
            )}
        </section>
    );
};

export default LocationsTab;
