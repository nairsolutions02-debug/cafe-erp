import React, { useEffect, useState } from 'react';
import { getSettings, updateSetting, getPortalConfig } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { errorText } from '../inventory/shared';

const TEXTS = [
    ['heading', 'Page heading'], ['pointsLabel', 'Points line ({points})'], ['progress', 'Progress line ({left}, {reward})'],
    ['noRewards', 'No coupons yet'], ['pointsAdded', 'Points added'], ['instagram', 'Instagram ask'], ['underReview', 'Instagram under review'],
    ['feedbackAsk', 'Ask for dish ratings'], ['feedbackThanks', 'After rating'], ['review', 'Google review button'],
];
const SWITCHES = [
    ['points', 'Points balance'], ['progress', 'Progress bar to the next reward'], ['upcoming', 'Upcoming rewards (birthday, Instagram…)'],
    ['offers', 'Offers to use points on'], ['instagram', 'Instagram tag for a reward'], ['feedback', 'Dish ratings after paying'], ['review', 'Google review button'],
];
const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

// What customers see on their Rewards page: every line is editable, every block can be hidden
const PortalTab = () => {
    const { hasPerm } = useAuth();
    const [cfg, setCfg] = useState(null);
    const [extra, setExtra] = useState({ google: '', insta: '' });
    const [msg, setMsg] = useState('');
    useEffect(() => {
        getPortalConfig().then(r => setCfg(r.data));
        getSettings().then(r => setExtra({ google: r.data.google_review_url || '', insta: r.data.instagram_handle || '' }));
    }, []);
    if (!cfg) return <p>Loading…</p>;
    const canEdit = hasPerm('settings.edit');
    const save = async () => {
        try {
            await updateSetting('portal_texts', cfg.texts);
            await updateSetting('portal_show', cfg.show);
            await updateSetting('google_review_url', extra.google.trim());
            await updateSetting('instagram_handle', extra.insta.replace(/^@/, '').trim());
            setMsg('Saved');
        } catch (err) { setMsg(errorText(err)); }
    };
    return (
        <div className="portal-grid">
            <div>
                <h3 className="section-title">Show to customers</h3>
                {SWITCHES.map(([k, l]) => (
                    <label key={k} className="check"><input type="checkbox" disabled={!canEdit} checked={!!cfg.show[k]}
                        onChange={e => setCfg({ ...cfg, show: { ...cfg.show, [k]: e.target.checked } })} /> {l}</label>
                ))}
                <h3 className="section-title">Links</h3>
                <div className="input-group"><label>Google review link <span className="hint">Google Maps → your cafe → Share review link</span></label>
                    <input className="input" disabled={!canEdit} value={extra.google} onChange={e => setExtra({ ...extra, google: e.target.value })} placeholder="https://g.page/r/…/review" /></div>
                <div className="input-group"><label>Cafe Instagram username</label>
                    <input className="input" disabled={!canEdit} value={extra.insta} onChange={e => setExtra({ ...extra, insta: e.target.value })} placeholder="fikacafe" /></div>
                <p className="muted small">The review button shows to every customer after paying, whatever their rating — Google bans showing it only to happy customers.</p>
            </div>
            <div>
                <h3 className="section-title">Slogans and texts</h3>
                {TEXTS.map(([k, l]) => (
                    <div key={k} className="input-group"><label>{l}</label>
                        <input className="input" disabled={!canEdit} value={cfg.texts[k] || ''} onChange={e => setCfg({ ...cfg, texts: { ...cfg.texts, [k]: e.target.value } })} /></div>
                ))}
                <div className="portal-preview" aria-label="Preview">
                    <span className="muted small">Preview</span>
                    <strong>{cfg.texts.heading}</strong>
                    {cfg.show.points && <div>{fill(cfg.texts.pointsLabel, { points: 240 })}</div>}
                    {cfg.show.progress && <div>{fill(cfg.texts.progress, { left: '2 more orders', reward: 'Free Brownie' })}</div>}
                </div>
            </div>
            {canEdit && <div className="btn-row"><button className="btn btn-primary" onClick={save}>Save portal</button>{msg && <span className="small">{msg}</span>}</div>}
        </div>
    );
};

export default PortalTab;
