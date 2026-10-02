import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getStockLocations, getVendors } from '../utils/api';
import StockTab from './inventory/StockTab';
import PurchasesTab from './inventory/PurchasesTab';
import CountsTab from './inventory/CountsTab';
import MovesTab from './inventory/MovesTab';
import VendorsTab from './inventory/VendorsTab';
import LocationsTab from './inventory/LocationsTab';
import './AdminStaff.css';
import './AdminCatalogue.css';
import './inventory/Inventory.css';

const TABS = [
    { key: 'stock', label: 'Stock' },
    { key: 'purchases', label: 'Purchases' },
    { key: 'counts', label: 'Counts & leaks' },
    { key: 'moves', label: 'Movements' },
    { key: 'vendors', label: 'Vendors' },
    { key: 'locations', label: 'Locations' },
];

// Inventory: every change of stock is an entry in the stock ledger (Movements tab)
const AdminInventory = () => {
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'stock';
    const q = params.get('q') || '';
    const [locations, setLocations] = useState([]);
    const [vendors, setVendors] = useState([]);

    const loadLocations = useCallback(async () => setLocations((await getStockLocations()).data), []);
    const loadVendors = useCallback(async () => setVendors((await getVendors()).data), []);
    useEffect(() => { loadLocations(); loadVendors(); }, [loadLocations, loadVendors]);

    const go = (key) => setParams(key === 'stock' ? {} : { tab: key });
    const shared = { locations, vendors, reloadLocations: loadLocations, reloadVendors: loadVendors, q };

    return (
        <div className="admin-inventory inv">
            <div className="page-header">
                <h1>Inventory</h1>
                <p>Stock by location, purchases, recipes deducting on every sale, counts and leaks.</p>
            </div>
            <div className="tabs" role="tablist">
                {TABS.map(t => (
                    <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => go(t.key)}>
                        {t.label}
                    </button>
                ))}
            </div>
            {tab === 'stock' && <StockTab key={q} {...shared} />}
            {tab === 'purchases' && <PurchasesTab {...shared} />}
            {tab === 'counts' && <CountsTab {...shared} />}
            {tab === 'moves' && <MovesTab {...shared} />}
            {tab === 'vendors' && <VendorsTab key={q} {...shared} />}
            {tab === 'locations' && <LocationsTab {...shared} />}
        </div>
    );
};

export default AdminInventory;
