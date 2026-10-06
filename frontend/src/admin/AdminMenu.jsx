import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiPlus, FiEdit2, FiTrash2, FiImage, FiSearch } from 'react-icons/fi';
import {
    getAllMenuItems, getAllCategories, createMenuItem, updateMenuItem, deleteMenuItem, updateStock, setSoldAt,
    getBrands, getTaxGroups, getItemUnits, createItemUnit, deleteItemUnit,
} from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getImageUrl } from '../utils/config';
import './AdminMenu.css';
import InfoTip from './help/InfoTip';

const EMPTY_FORM = {
        name: '', nameHi: '', description: '', price: '', category: '',
        isVeg: true, isBestSeller: false, isNewItem: false, isRecommended: false, isUpsell: false,
        preparationTime: 15, stockQuantity: -1,
        itemType: 'dish', brand: '', taxGroup: '', mrp: '', priceIncludesTax: false, isRestricted: false, unit: 'pc', sku: '', soldInShop: true, soldAtKiosk: true
    };

// "Beverages › Cold Drinks" for sub-categories
const categoryLabel = (c, all) => {
    const parent = c.parentId && all.find(p => p._id === c.parentId);
    return parent ? `${parent.name} › ${c.name}` : c.name;
};

const AdminMenu = () => {
    const { hasPerm } = useAuth();
    const [searchParams] = useSearchParams();
    const [query, setQuery] = useState(searchParams.get('q') || '');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [placeFilter, setPlaceFilter] = useState('');
    const [brands, setBrands] = useState([]);
    const [taxGroups, setTaxGroups] = useState([]);
    const [units, setUnits] = useState([]);
    const [newUnit, setNewUnit] = useState({ name: 'Pack', factor: '', salePrice: '' });
    const [items, setItems] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [image, setImage] = useState(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [itemsRes, catRes, brandRes, taxRes] = await Promise.all([
                getAllMenuItems(), getAllCategories(), getBrands(), getTaxGroups()]);
            setItems(itemsRes.data);
            setCategories(catRes.data);
            setBrands(brandRes.data);
            setTaxGroups(taxRes.data);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const data = new FormData();
        Object.keys(formData).forEach(key => data.append(key, formData[key]));
        if (image) data.append('image', image);

        try {
            if (editItem) {
                await updateMenuItem(editItem._id, data);
            } else {
                await createMenuItem(data);
            }
            setShowModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            alert(error.response?.data?.message || 'Failed to save item');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this item?')) {
            try {
                await deleteMenuItem(id);
                fetchData();
            } catch (error) {
                alert('Failed to delete');
            }
        }
    };

    // One tap on the card: switch where the item is sold (at least one place stays on)
    const handleSoldAt = async (item, key) => {
        const next = { soldInShop: item.soldInShop !== false, soldAtKiosk: item.soldAtKiosk !== false };
        next[key] = !next[key];
        if (!next.soldInShop && !next.soldAtKiosk) {
            alert('An item must be sold somewhere. To stop selling it everywhere, mark it Out of Stock.');
            return;
        }
        try {
            await setSoldAt(item._id, next);
            fetchData();
        } catch (error) {
            alert(error?.response?.data?.message || 'Failed to update');
        }
    };

    const handleStockToggle = async (item) => {
        try {
            await updateStock(item._id, { isAvailable: !item.isAvailable });
            fetchData();
        } catch (error) {
            alert('Failed to update stock');
        }
    };

    const openEdit = async (item) => {
        setEditItem(item);
        setFormData({
            name: item.name, nameHi: item.nameHi || '', description: item.description || '', price: item.price,
            category: item.category?._id || '', isVeg: item.isVeg,
            isBestSeller: item.isBestSeller, isNewItem: item.isNewItem, isRecommended: item.isRecommended, isUpsell: item.isUpsell,
            preparationTime: item.preparationTime, stockQuantity: item.stockQuantity,
            itemType: item.itemType || 'dish', brand: item.brand?._id || '', taxGroup: item.taxGroup || '',
            mrp: item.mrp ?? '', priceIncludesTax: !!item.priceIncludesTax, isRestricted: !!item.isRestricted,
            unit: item.unit || 'pc', sku: item.sku || '', hsnCode: item.hsnCode || '',
            soldInShop: item.soldInShop !== false, soldAtKiosk: item.soldAtKiosk !== false
        });
        setShowModal(true);
        try {
            setUnits((await getItemUnits(item._id)).data);
        } catch {
            setUnits([]);
        }
    };

    const resetForm = () => {
        setEditItem(null);
        setFormData(EMPTY_FORM);
        setUnits([]);
        setImage(null);
    };

    const addUnit = async () => {
        if (!newUnit.name || !(Number(newUnit.factor) > 0)) return;
        try {
            await createItemUnit(editItem._id, newUnit);
            setUnits((await getItemUnits(editItem._id)).data);
            setNewUnit({ name: 'Pack', factor: '', salePrice: '' });
        } catch (error) {
            alert(error.response?.data?.message || 'Could not add unit');
        }
    };

    const removeUnit = async (id) => {
        await deleteItemUnit(id);
        setUnits(units.filter(u => u._id !== id));
    };

    const q = query.trim().toLowerCase();
    const visibleItems = items.filter(item =>
        (!q || item.name.toLowerCase().includes(q) || (item.brand?.name || '').toLowerCase().includes(q))
        && (!categoryFilter || item.category?._id === categoryFilter
            || categories.find(c => c._id === item.category?._id)?.parentId === categoryFilter)
        && (!placeFilter
            || (placeFilter === 'kiosk' && item.soldAtKiosk !== false)
            || (placeFilter === 'shop' && item.soldInShop !== false)
            || (placeFilter === 'kiosk-only' && item.soldInShop === false)
            || (placeFilter === 'shop-only' && item.soldAtKiosk === false)));
    const sortedCategories = [...categories].sort((a, b) =>
        categoryLabel(a, categories).localeCompare(categoryLabel(b, categories)));

    if (loading) return <div className="admin-loading"><div className="spinner"></div></div>;

    return (
        <div className="admin-menu">
            <div className="page-header">
                <h1>Menu Management</h1>
                {hasPerm('menu.create') && (
                    <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
                        <FiPlus /> Add Item
                    </button>
                )}
            </div>

            <div className="menu-filters">
                <div className="menu-search">
                    <FiSearch />
                    <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search items or brands" />
                </div>
                <select className="input" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                    <option value="">All categories</option>
                    {sortedCategories.map(c => <option key={c._id} value={c._id}>{categoryLabel(c, categories)}</option>)}
                </select>
                <select className="input" value={placeFilter} onChange={e => setPlaceFilter(e.target.value)} aria-label="Where sold">
                    <option value="">Shop and kiosk</option>
                    <option value="shop">Sold in the main shop</option>
                    <option value="kiosk">Sold at the kiosk</option>
                    <option value="shop-only">Main shop only</option>
                    <option value="kiosk-only">Kiosk only</option>
                </select>
                <span className="menu-count">{visibleItems.length} of {items.length}</span>
            </div>

            <div className="items-grid">
                {visibleItems.map(item => (
                    <div key={item._id} className={`item-card ${!item.isAvailable ? 'out-of-stock' : ''}`}>
                        <div className="item-image">
                            {item.image ? (
                                <img src={getImageUrl(item.image)} alt={item.name} />
                            ) : (
                                <div className="no-image"><FiImage /></div>
                            )}
                            {item.isBestSeller && <span className="badge bestseller">Bestseller</span>}
                            {item.isNewItem && <span className="badge new">New</span>}
                            {item.isRestricted && <span className="badge restricted">Restricted</span>}
                        </div>
                        <div className="item-content">
                            <div className="item-header">
                                <span className={item.isVeg ? 'badge-veg' : 'badge-non-veg'}></span>
                                <h3>{item.name}</h3>
                            </div>
                            <p className="item-category">
                                {[item.category?.name, item.brand?.name].filter(Boolean).join(' · ')}
                                {item.mrp ? ` · MRP ₹${item.mrp}` : ''}
                            </p>
                            <div className="sold-at" role="group" aria-label={`Where ${item.name} is sold`}>
                                <button type="button" disabled={!hasPerm('menu.edit')} aria-pressed={item.soldInShop !== false}
                                    className={`sold-chip${item.soldInShop !== false ? ' on' : ''}`} onClick={() => handleSoldAt(item, 'soldInShop')}>
                                    {item.soldInShop !== false ? '✓ ' : ''}Main shop</button>
                                <button type="button" disabled={!hasPerm('menu.edit')} aria-pressed={item.soldAtKiosk !== false}
                                    className={`sold-chip${item.soldAtKiosk !== false ? ' on' : ''}`} onClick={() => handleSoldAt(item, 'soldAtKiosk')}>
                                    {item.soldAtKiosk !== false ? '✓ ' : ''}Kiosk</button>
                            </div>
                            <div className="item-footer">
                                <span className="item-price">₹{item.price}</span>
                                <div className="item-actions">
                                    <button onClick={() => handleStockToggle(item)} disabled={!hasPerm('menu.edit')}
                                        className={`stock-btn ${item.isAvailable ? 'in' : 'out'}`}>
                                        {item.isAvailable ? 'In Stock' : 'Out of Stock'}
                                    </button>
                                    {hasPerm('menu.edit') && <button onClick={() => openEdit(item)} className="icon-btn edit" aria-label="Edit"><FiEdit2 /></button>}
                                    {hasPerm('menu.delete') && <button onClick={() => handleDelete(item._id)} className="icon-btn delete" aria-label="Delete"><FiTrash2 /></button>}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editItem ? 'Edit Item' : 'Add Item'}</h2>
                            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="form-grid">
                                    <div className="input-group">
                                        <label>Name *</label>
                                        <input type="text" className="input" value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                                    </div>
                                    <div className="input-group">
                                        <label>Name in Hindi <span className="muted small">(optional)</span><InfoTip k="name_hi" /></label>
                                        <input type="text" className="input" lang="hi" placeholder="मसाला डोसा" value={formData.nameHi || ''}
                                            onChange={e => setFormData({ ...formData, nameHi: e.target.value })} />
                                    </div>
                                    <div className="input-group">
                                        <label>Price *</label>
                                        <input type="number" className="input" value={formData.price}
                                            onChange={e => setFormData({ ...formData, price: e.target.value })} required />
                                    </div>
                                    <div className="input-group">
                                        <label>Category *</label>
                                        <select className="input" value={formData.category}
                                            onChange={e => setFormData({ ...formData, category: e.target.value })} required>
                                            <option value="">Select Category</option>
                                            {sortedCategories.map(c => <option key={c._id} value={c._id}>{categoryLabel(c, categories)}</option>)}
                                        </select>
                                    </div>
                                    <div className="input-group image-upload-group">
                                        <label>Image</label>
                                        <input type="file" accept="image/*" onChange={e => setImage(e.target.files[0])} />
                                        {/* Image Preview */}
                                        {(image || (editItem && editItem.image)) && (
                                            <div className="image-preview-container">
                                                <img
                                                    src={image ? URL.createObjectURL(image) : getImageUrl(editItem.image)}
                                                    alt="Preview"
                                                    className="image-preview"
                                                />
                                                {image && (
                                                    <button
                                                        type="button"
                                                        className="remove-preview-btn"
                                                        onClick={() => setImage(null)}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>Description</label>
                                    <textarea className="input" value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })} rows={2} />
                                </div>
                                {/* Veg/Non-Veg Toggle */}
                                <div className="veg-toggle-group">
                                    <label className="toggle-label">Food Type *</label>
                                    <div className="veg-toggle-container">
                                        <button
                                            type="button"
                                            className={`veg-toggle-btn ${formData.isVeg ? 'active veg' : ''}`}
                                            onClick={() => setFormData({ ...formData, isVeg: true })}
                                        >
                                            <span className="veg-indicator veg"></span>
                                            Veg
                                        </button>
                                        <button
                                            type="button"
                                            className={`veg-toggle-btn ${!formData.isVeg ? 'active non-veg' : ''}`}
                                            onClick={() => setFormData({ ...formData, isVeg: false })}
                                        >
                                            <span className="veg-indicator non-veg"></span>
                                            Non-Veg
                                        </button>
                                    </div>
                                </div>

                                <fieldset className="form-section">
                                    <legend>Catalogue &amp; tax</legend>
                                    <div className="form-grid">
                                        <div className="input-group">
                                            <label>Item type<InfoTip k="item_type" /></label>
                                            <select className="input" value={formData.itemType}
                                                onChange={e => setFormData({ ...formData, itemType: e.target.value })}>
                                                <option value="dish">Prepared dish</option>
                                                <option value="resale">Resale product (bought ready, e.g. Coke)</option>
                                                <option value="combo">Combo</option>
                                            </select>
                                        </div>
                                        <div className="input-group">
                                            <label>Brand</label>
                                            <select className="input" value={formData.brand}
                                                onChange={e => setFormData({ ...formData, brand: e.target.value })}>
                                                <option value="">No brand</option>
                                                {brands.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="input-group">
                                            <label>Tax group<InfoTip k="tax_group" /></label>
                                            <select className="input" value={formData.taxGroup}
                                                onChange={e => setFormData({ ...formData, taxGroup: e.target.value })}>
                                                <option value="">Cafe default (Settings)</option>
                                                {taxGroups.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="input-group">
                                            <label>MRP (₹, packaged goods)</label>
                                            <input type="number" step="0.01" className="input" value={formData.mrp}
                                                onChange={e => setFormData({ ...formData, mrp: e.target.value })} placeholder="Leave empty if none" />
                                        </div>
                                        <div className="input-group">
                                            <label>Selling unit</label>
                                            <input className="input" value={formData.unit}
                                                onChange={e => setFormData({ ...formData, unit: e.target.value })} placeholder="pc, glass, plate" />
                                        </div>
                                        <div className="input-group">
                                            <label>HSN code (GST pack; blank = restaurant SAC)<InfoTip k="hsn" /></label>
                                            <input className="input" value={formData.hsnCode || ''}
                                                onChange={e => setFormData({ ...formData, hsnCode: e.target.value })} />
                                        </div>
                                        <div className="input-group">
                                            <label>SKU / barcode</label>
                                            <input className="input" value={formData.sku}
                                                onChange={e => setFormData({ ...formData, sku: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="checkbox-group">
                                        <label><input type="checkbox" checked={formData.priceIncludesTax}
                                            onChange={e => setFormData({ ...formData, priceIncludesTax: e.target.checked })} /> Price includes tax (MRP items)<InfoTip k="price_incl_tax" /></label>
                                        <label><input type="checkbox" checked={formData.isRestricted}
                                            onChange={e => setFormData({ ...formData, isRestricted: e.target.checked })} /> Restricted (tobacco etc.: no rewards, coupons or promotions)<InfoTip k="restricted" /></label>
                                    </div>
                                    <div className="checkbox-group">
                                        <span className="toggle-label">Sold at<InfoTip k="sold_at" /></span>
                                        <label><input type="checkbox" checked={formData.soldInShop}
                                            onChange={e => setFormData({ ...formData, soldInShop: e.target.checked || !formData.soldAtKiosk })} /> Main shop (counter and customer menu)</label>
                                        <label><input type="checkbox" checked={formData.soldAtKiosk}
                                            onChange={e => setFormData({ ...formData, soldAtKiosk: e.target.checked || !formData.soldInShop })} /> Kiosk</label>
                                    </div>
                                    {editItem && (
                                        <div className="units-editor">
                                            <label className="toggle-label">Pack units<InfoTip k="pack_units" /></label>
                                            {units.length === 0 && <p className="hint">e.g. 1 Pack = 10 pieces. Selling a pack removes 10 from stock.</p>}
                                            {units.map(u => (
                                                <div key={u._id} className="unit-row">
                                                    <span>1 {u.name} = {u.factor} {formData.unit || 'pc'}{u.salePrice ? ` · ₹${u.salePrice}` : ''}</span>
                                                    <button type="button" className="icon-btn delete" onClick={() => removeUnit(u._id)} aria-label="Remove unit"><FiTrash2 /></button>
                                                </div>
                                            ))}
                                            <div className="unit-row add">
                                                <input className="input" value={newUnit.name} onChange={e => setNewUnit({ ...newUnit, name: e.target.value })} placeholder="Pack" />
                                                <input className="input" type="number" value={newUnit.factor} onChange={e => setNewUnit({ ...newUnit, factor: e.target.value })} placeholder="10" />
                                                <input className="input" type="number" value={newUnit.salePrice} onChange={e => setNewUnit({ ...newUnit, salePrice: e.target.value })} placeholder="Price ₹ (optional)" />
                                                <button type="button" className="btn btn-ghost" onClick={addUnit}>Add</button>
                                            </div>
                                        </div>
                                    )}
                                </fieldset>

                                <div className="checkbox-group">
                                    <label><input type="checkbox" checked={formData.isBestSeller}
                                        onChange={e => setFormData({ ...formData, isBestSeller: e.target.checked })} /> Bestseller</label>
                                    <label><input type="checkbox" checked={formData.isNewItem}
                                        onChange={e => setFormData({ ...formData, isNewItem: e.target.checked })} /> New</label>
                                    <label><input type="checkbox" checked={formData.isRecommended}
                                        onChange={e => setFormData({ ...formData, isRecommended: e.target.checked })} /> Recommended</label>
                                    <label><input type="checkbox" checked={formData.isUpsell}
                                        onChange={e => setFormData({ ...formData, isUpsell: e.target.checked })} /> Show as Cart Suggestion<InfoTip k="upsell" /></label>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminMenu;
