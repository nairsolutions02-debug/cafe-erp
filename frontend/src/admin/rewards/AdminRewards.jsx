import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import RulesTab from './RulesTab';
import TodoTab from './TodoTab';
import InstagramTab from './InstagramTab';
import FeedbackTab from './FeedbackTab';
import GroupsTab from './GroupsTab';
import PortalTab from './PortalTab';
import '../AdminStaff.css';
import '../AdminCatalogue.css';
import '../inventory/Inventory.css';
import './Rewards.css';

const TABS = [
    { key: 'rules', label: 'Rules', perm: 'rewards.view' },
    { key: 'todo', label: 'WhatsApp to-do', perm: 'customers.view' },
    { key: 'instagram', label: 'Instagram', perm: 'customers.view' },
    { key: 'feedback', label: 'Feedback', perm: 'customers.view' },
    { key: 'groups', label: 'Groups', perm: 'customers.view' },
    { key: 'portal', label: 'Customer portal', perm: 'settings.view' },
];

// Rewards: rule builder, messages to send, Instagram checks, dish ratings, customer groups, portal texts
const AdminRewards = () => {
    const { hasPerm } = useAuth();
    const [params, setParams] = useSearchParams();
    const tabs = TABS.filter(t => hasPerm(t.perm));
    const tab = tabs.some(t => t.key === params.get('tab')) ? params.get('tab') : tabs[0]?.key;
    return (
        <div className="inv rewards-admin">
            <div className="page-header">
                <h1>Rewards</h1>
                <p>Reward rules, WhatsApp messages to send, Instagram checks, dish ratings and customer groups.</p>
            </div>
            <div className="tabs" role="tablist">
                {tabs.map(t => (
                    <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''}
                        onClick={() => setParams(t.key === 'rules' ? {} : { tab: t.key })}>{t.label}</button>
                ))}
            </div>
            {tab === 'rules' && <RulesTab />}
            {tab === 'todo' && <TodoTab />}
            {tab === 'instagram' && <InstagramTab />}
            {tab === 'feedback' && <FeedbackTab />}
            {tab === 'groups' && <GroupsTab />}
            {tab === 'portal' && <PortalTab />}
        </div>
    );
};

export default AdminRewards;
