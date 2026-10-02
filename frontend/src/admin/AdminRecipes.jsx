import React, { useCallback, useEffect, useState } from 'react';
import { FiEdit2, FiPlus, FiTrash2, FiPackage } from 'react-icons/fi';
import { getMenuCosting, getRecipe, saveRecipe, trackMenuItemStock, getStock, getStockLocations } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Modal from './inventory/Modal';
import { errorText, fmtMoney, fmtUnitCost } from './inventory/shared';
import './AdminStaff.css';
import './inventory/Inventory.css';

const costTone = (pct) => (pct == null ? '' : pct > 40 ? 'cost-high' : pct <= 30 ? 'cost-good' : '');

// Edit one dish's recipe: ingredients × quantity (+ waste %), and where its sales take stock from
const RecipeModal = ({ row, stock, locations, onClose, onSaved }) => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const canEdit = hasPerm('menu.edit');
    const [recipe, setRecipe] = useState(null);
    const [lines, setLines] = useState([]);
    const [locationId, setLocationId] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getRecipe(row.menuItemId).then(r => {
            setRecipe(r.data);
            setLines(r.data.lines.map(l => ({ itemId: l.itemId, quantity: l.quantity, wastePct: l.wastePct })));
            setLocationId(r.data.stockLocationId || '');
        });
    }, [row.menuItemId]);

    const itemOf = (id) => stock.find(s => s.id === id);
    const lineCost = (l) => {
        const it = itemOf(l.itemId);
        if (!it || it.avgCost == null) return null;
        return Number(l.quantity || 0) * (1 + Number(l.wastePct || 0) / 100) * Number(it.avgCost);
    };
    const total = lines.reduce((a, l) => a + (lineCost(l) || 0), 0);
    const pct = row.netPrice > 0 && lines.length ? (total / row.netPrice) * 100 : null;
    const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            await saveRecipe(row.menuItemId, lines.filter(l => l.itemId).map(l => ({
                itemId: l.itemId, quantity: Number(l.quantity), wastePct: Number(l.wastePct || 0) })), locationId);
            onSaved();
        } catch (err) {
            setError(errorText(err, 'Could not save the recipe'));
        } finally {
            setSaving(false);
        }
    };

    const track = async () => {
        try {
            await trackMenuItemStock(row.menuItemId);
            onSaved();
        } catch (err) {
            setError(errorText(err, 'Could not create the stock item'));
        }
    };

    return (
        <Modal title={`Recipe · ${row.name}`} onClose={onClose} wide>
            <div className="modal-body">
                {!recipe ? <p className="muted">Loading…</p> : (
                    <>
                        <p className="muted">One portion, sold at {fmtMoney(row.price)}{row.netPrice !== row.price && ` (${fmtMoney(row.netPrice)} before tax)`}.
                            Quantities are in each ingredient's base unit.</p>
                        {row.itemType === 'resale' && lines.length === 0 && canEdit && hasPerm('inventory.create') && (
                            <div className="formula">
                                Sold as it is (bottle, pack, piece)? <button className="link-btn" onClick={track}><FiPackage /> Track it as its own stock item</button>
                                — creates "{row.name}" in Inventory and a 1-piece recipe, so each sale takes one off.
                            </div>
                        )}
                        <div className="purchase-lines">
                            <div className="line-row recipe head"><span>Ingredient</span><span>Quantity</span><span>Unit</span><span>Waste %</span><span>Cost</span><span /></div>
                            {lines.map((l, i) => {
                                const it = itemOf(l.itemId);
                                const c = lineCost(l);
                                return (
                                    <div className="line-row recipe" key={i}>
                                        <select className="input" value={l.itemId} disabled={!canEdit} aria-label="Ingredient" onChange={e => setLine(i, { itemId: e.target.value })}>
                                            <option value="">Choose…</option>
                                            {stock.filter(s => s.isActive || s.id === l.itemId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                        <input className="input" type="number" min="0" step="any" value={l.quantity} disabled={!canEdit} aria-label="Quantity"
                                            onChange={e => setLine(i, { quantity: e.target.value })} />
                                        <span className="muted">{it?.unit || ''}</span>
                                        <input className="input" type="number" min="0" max="89" step="any" value={l.wastePct} disabled={!canEdit} aria-label="Waste %"
                                            onChange={e => setLine(i, { wastePct: e.target.value })} placeholder="0" />
                                        <span className="num">{seeCost && c != null ? fmtMoney(c) : ''}</span>
                                        {canEdit && <button type="button" className="icon-btn delete" aria-label="Remove ingredient"
                                            onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><FiTrash2 /></button>}
                                    </div>
                                );
                            })}
                            {canEdit && (
                                <button type="button" className="link-btn" onClick={() => setLines(ls => [...ls, { itemId: '', quantity: '', wastePct: '' }])}>
                                    <FiPlus /> Add ingredient
                                </button>
                            )}
                            {stock.length === 0 && <p className="muted small">No stock items yet. Add ingredients in Inventory → Stock first.</p>}
                        </div>
                        {seeCost && (
                            <div className="recipe-total">
                                <span>Cost per portion <strong>{fmtMoney(total)}</strong></span>
                                {pct != null && hasPerm('sensitive.see_profit') && (
                                    <>
                                        <span>Food cost <strong className={costTone(pct)}>{pct.toFixed(1)}%</strong></span>
                                        <span>Margin <strong>{fmtMoney(row.netPrice - total)}</strong></span>
                                    </>
                                )}
                            </div>
                        )}
                        <div className="input-group">
                            <label>Sales take stock from</label>
                            <select className="input" value={locationId} disabled={!canEdit} onChange={e => setLocationId(e.target.value)}>
                                <option value="">Automatic (category, else sales location){!recipe.stockLocationId && recipe.saleLocation ? ` · now ${recipe.saleLocation}` : ''}</option>
                                {locations.filter(l => l.isActive).map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                            </select>
                        </div>
                        <p className="formula">Cost = Σ quantity × (1 + waste %) × ingredient average cost. Average cost comes from purchases
                            (weighted by quantity), so dish costs update when prices change. Food cost % = cost ÷ price before tax.</p>
                        {error && <p className="error-message">{error}</p>}
                    </>
                )}
            </div>
            {canEdit && (
                <div className="modal-footer">
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" disabled={saving || !recipe} onClick={save}>{saving ? 'Saving…' : 'Save recipe'}</button>
                </div>
            )}
        </Modal>
    );
};

// Every menu item with its recipe, cost, food cost % and margin
const AdminRecipes = () => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const seeProfit = hasPerm('sensitive.see_profit');
    const canStock = hasPerm('inventory.view');
    const [rows, setRows] = useState([]);
    const [stock, setStock] = useState([]);
    const [locations, setLocations] = useState([]);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [editing, setEditing] = useState(null);

    const load = useCallback(async () => setRows((await getMenuCosting()).data), []);
    useEffect(() => {
        load();
        if (canStock) {
            getStock().then(r => setStock(r.data));
            getStockLocations().then(r => setLocations(r.data));
        }
    }, [load, canStock]);

    const shown = rows.filter(r => {
        if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (filter === 'missing') return !r.hasRecipe;
        if (filter === 'high') return r.foodCostPct != null && r.foodCostPct > 40;
        return true;
    });
    const withRecipe = rows.filter(r => r.hasRecipe).length;
    const pcts = rows.filter(r => r.foodCostPct != null).map(r => Number(r.foodCostPct));
    const avgPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;

    return (
        <div className="recipes-page">
            <div className="page-header">
                <h1>Recipes &amp; Costing</h1>
                <p>What each dish uses, what it costs to make and what it earns. Every sale deducts its recipe from stock.</p>
            </div>
            <div className="inv-toolbar">
                <input className="input search" placeholder="Search dishes…" value={search} onChange={e => setSearch(e.target.value)} />
                <select className="input compact" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter">
                    <option value="all">All items</option>
                    <option value="missing">Missing recipe</option>
                    {seeProfit && <option value="high">Food cost above 40%</option>}
                </select>
            </div>
            <div className="inv-summary">
                <span><strong>{withRecipe}</strong> of {rows.length} items have a recipe</span>
                {seeProfit && avgPct != null && <span>Average food cost <strong className={costTone(avgPct)}>{avgPct.toFixed(1)}%</strong></span>}
                {!canStock && <span className="warn">You need Inventory: View to edit recipes.</span>}
            </div>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead>
                        <tr>
                            <th>Item</th><th>Price</th>
                            {seeCost && <th>Cost</th>}
                            {seeProfit && <th>Food cost</th>}
                            {seeProfit && <th>Margin</th>}
                            <th>Recipe</th><th aria-label="Actions" />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map(r => (
                            <tr key={r.menuItemId} className={r.isAvailable ? '' : 'inactive'}>
                                <td><strong>{r.name}</strong><div className="muted small">{r.category || 'No category'}{r.itemType !== 'dish' ? ` · ${r.itemType}` : ''}</div></td>
                                <td>{fmtMoney(r.price)}</td>
                                {seeCost && <td>{r.cost != null ? fmtMoney(r.cost) : <span className="muted">unknown</span>}</td>}
                                {seeProfit && <td className={costTone(r.foodCostPct)}>{r.foodCostPct != null ? `${r.foodCostPct}%` : '—'}</td>}
                                {seeProfit && <td>{r.margin != null ? fmtMoney(r.margin) : '—'}</td>}
                                <td>
                                    {r.hasRecipe ? `${r.ingredients} ingredient${r.ingredients > 1 ? 's' : ''}`
                                        : r.costSource === 'manual' ? <span className="pill muted">Manual cost</span>
                                            : <span className="pill warn">Missing</span>}
                                </td>
                                <td>{canStock && (
                                    <button className="icon-btn" aria-label={`Recipe ${r.name}`} title={hasPerm('menu.edit') ? 'Edit recipe' : 'View recipe'}
                                        onClick={() => setEditing(r)}><FiEdit2 /></button>
                                )}</td>
                            </tr>
                        ))}
                        {shown.length === 0 && <tr><td colSpan={7} className="empty muted">Nothing matches.</td></tr>}
                    </tbody>
                </table>
            </div>
            <p className="formula" style={{ marginTop: 12 }}>
                Items without a recipe still sell, but show "cost unknown" and don't deduct stock. Manual cost = the cost price typed on the menu item.
                {stock.length > 0 && seeCost && ` Ingredient costs: ${stock.slice(0, 3).map(s => `${s.name} ${fmtUnitCost(s.avgCost, s.unit)}`).join(', ')}${stock.length > 3 ? '…' : ''}`}
            </p>
            {editing && (
                <RecipeModal row={editing} stock={stock} locations={locations} onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); load(); getStock().then(r => setStock(r.data)); }} />
            )}
        </div>
    );
};

export default AdminRecipes;
