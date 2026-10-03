import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import SuggestionsTab from './SuggestionsTab';
import MatrixTab from './MatrixTab';
import ImportTab from './ImportTab';
import '../AdminStaff.css';
import '../AdminCatalogue.css';
import '../inventory/Inventory.css';
import '../pos/POS.css';
import '../rewards/Rewards.css';
import './Profit.css';

// Profit advisor: checks on the cafe's own numbers → suggestions with the working; menu matrix; aggregator import
const AdminProfit = () => {
    const { hasPerm } = useAuth();
    const [params, setParams] = useSearchParams();
    const seeProfit = hasPerm('sensitive.see_profit');
    const tabs = [
        seeProfit && ['open', 'Suggestions'],
        seeProfit && ['matrix', 'Menu matrix'],
        seeProfit && ['decided', 'Decisions & results'],
        hasPerm('finance.create') && ['import', 'Swiggy / Zomato import'],
    ].filter(Boolean);
    const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : tabs[0]?.[0];
    return (
        <div className="inv profit-page">
            <div className="page-header"><h1>Profit advisor</h1><p>Checks on your own sales, recipes, stock and costs, with the ₹ impact and the working behind each suggestion.</p></div>
            <div className="tabs" role="tablist">
                {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''}
                    onClick={() => setParams(k === 'open' ? {} : { tab: k })}>{l}</button>)}
            </div>
            {tab === 'open' && <SuggestionsTab status="open" />}
            {tab === 'matrix' && <MatrixTab />}
            {tab === 'decided' && <SuggestionsTab key="decided" status="decided" />}
            {tab === 'import' && <ImportTab />}
            {!tab && <p className="muted">Your role needs <em>See profit</em> to use the advisor.</p>}
        </div>
    );
};

export default AdminProfit;
