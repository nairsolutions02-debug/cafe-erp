import { Link } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import { FiSettings, FiSave, FiPlus, FiTrash2, FiInfo } from 'react-icons/fi';
import { getAllSettings, updateSetting } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Skeleton from './mobile/Skeleton';
import DevicesCard from './DevicesCard';
import './AdminSettings.css';
import { useBrand } from '../context/BrandContext';
import InfoTip from './help/InfoTip';

const AdminSettings = () => {
    const brand = useBrand();
    const { hasPerm } = useAuth();
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [taxConfig, setTaxConfig] = useState([]);
    const [message, setMessage] = useState({ type: '', text: '' });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await getAllSettings();
            setSettings(res.data);

            // Handle tax_config specially as it's an array
            if (res.data.tax_config) {
                setTaxConfig(res.data.tax_config);
            } else {
                // Default if not set
                setTaxConfig([{ name: 'GST', rate: res.data.gst_rate || 5 }]);
            }
        } catch (error) {
            console.error('Error fetching settings:', error);
            showNotice('error', 'Failed to load settings');
        } finally {
            setLoading(false);
        }
    };

    const showNotice = (type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    };

    const handleBasicChange = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleTaxChange = (index, field, value) => {
        const newTaxConfig = [...taxConfig];
        newTaxConfig[index][field] = field === 'rate' ? parseFloat(value) || 0 : value;
        setTaxConfig(newTaxConfig);
    };

    const addTax = () => {
        setTaxConfig([...taxConfig, { name: 'New Tax', rate: 0 }]);
    };

    const removeTax = (index) => {
        if (taxConfig.length <= 1) {
            showNotice('error', 'At least one tax entry is required');
            return;
        }
        setTaxConfig(taxConfig.filter((_, i) => i !== index));
    };

    const saveSettings = async () => {
        setSaving(true);
        try {
            // Save basic settings
            // Name, address and phone are edited on Brand & look
            const basicKeys = ['gst_number', 'fssai_number', 'gst_rate',
                'service_charge_pct', 'round_off', 'bill_footer', 'shift_tolerance'];
            for (const key of basicKeys) {
                if (settings[key] !== undefined) {
                    await updateSetting(key, settings[key]);
                }
            }

            // Save tax config
            await updateSetting('tax_config', taxConfig);

            showNotice('success', 'Settings updated successfully!');
        } catch (error) {
            console.error('Error saving settings:', error);
            showNotice('error', 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <Skeleton label="Fetching your settings..." />;

    return (
        <div className="admin-settings">
            <div className="settings-header">
                <h1><FiSettings /> Store Settings</h1>
                <button
                    className="btn btn-primary btn-save"
                    onClick={saveSettings}
                    disabled={saving || !hasPerm('settings.edit')}
                    title={hasPerm('settings.edit') ? '' : 'Your role can view settings but not change them'}
                >
                    {saving ? 'Saving...' : <><FiSave /> Save Changes</>}
                </button>
            </div>

            {message.text && (
                <div className={`notice-banner ${message.type}`}>
                    {message.text}
                </div>
            )}

            <div className="settings-grid">
                {/* Restaurant Profile */}
                <div className="settings-card">
                    <h2>Restaurant Profile</h2>
                    <Link to="/admin/brand" className="brand-link-card">
                        <span><b>{brand.name}</b><small>{settings.restaurant_address || 'No address yet'}{settings.restaurant_phone ? ` · ${settings.restaurant_phone}` : ''}</small></span>
                        <span>Name, logo, address, phone and hours are on <b>Brand &amp; look</b> →</span>
                    </Link>
                    <div className="form-group">
                        <label>FSSAI licence number (printed on bills)<InfoTip k="fssai" /></label>
                        <input
                            type="text"
                            value={settings.fssai_number || ''}
                            onChange={(e) => handleBasicChange('fssai_number', e.target.value)}
                            placeholder="14-digit FSSAI number"
                        />
                    </div>
                    <div className="form-group">
                        <label>Service charge % (optional; 0 = off)<InfoTip k="service_charge" /></label>
                        <input
                            type="number" min="0" max="20" step="0.5"
                            value={settings.service_charge_pct ?? 0}
                            onChange={(e) => handleBasicChange('service_charge_pct', Number(e.target.value))}
                        />
                        <small className="hint">Shown as optional on QR and dine-in bills; staff remove it if the customer asks (consumer authority guidelines).</small>
                    </div>
                    <div className="form-group">
                        <label>
                            <input type="checkbox" checked={settings.round_off === true}
                                onChange={(e) => handleBasicChange('round_off', e.target.checked)} /> Round bill totals to the nearest rupee<InfoTip k="round_off" />
                        </label>
                    </div>
                    <div className="form-group">
                        <label>Bill footer<InfoTip k="bill_footer" /></label>
                        <input
                            type="text"
                            value={settings.bill_footer || ''}
                            onChange={(e) => handleBasicChange('bill_footer', e.target.value)}
                            placeholder="Thank you! Visit again."
                        />
                    </div>
                    <div className="form-group">
                        <label>Cash difference allowed at shift close (₹)<InfoTip k="shift_tolerance" /></label>
                        <input
                            type="number" min="0"
                            value={settings.shift_tolerance ?? 50}
                            onChange={(e) => handleBasicChange('shift_tolerance', Number(e.target.value))}
                        />
                        <small className="hint">A bigger difference needs a reason and alerts the owner.</small>
                    </div>
                </div>

                {/* Tax Configuration */}
                <div className="settings-card">
                    <div className="card-header-flex">
                        <h2>Tax Configuration<InfoTip k="tax_config" /></h2>
                        <button className="btn-add-tax" onClick={addTax}>
                            <FiPlus /> Add Tax
                        </button>
                    </div>

                    <div className="form-group">
                        <label>GST Registration Number (GSTIN)<InfoTip k="gstin" /></label>
                        <input
                            type="text"
                            value={settings.gst_number || ''}
                            onChange={(e) => handleBasicChange('gst_number', e.target.value)}
                            placeholder="Enter GSTIN"
                        />
                    </div>

                    <div className="tax-list">
                        <div className="tax-item-header">
                            <span>Tax Name</span>
                            <span>Rate (%)</span>
                            <span>Action</span>
                        </div>
                        {taxConfig.map((tax, index) => (
                            <div key={index} className="tax-item">
                                <input
                                    type="text"
                                    value={tax.name}
                                    onChange={(e) => handleTaxChange(index, 'name', e.target.value)}
                                />
                                <input
                                    type="number"
                                    value={tax.rate}
                                    onChange={(e) => handleTaxChange(index, 'rate', e.target.value)}
                                    step="0.01"
                                />
                                <button className="btn-delete" onClick={() => removeTax(index)}>
                                    <FiTrash2 />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="info-box">
                        <FiInfo />
                        <p>These taxes will be applied to all new orders. Changes will not affect existing orders.</p>
                    </div>
                </div>

                {/* Bill Settings */}
                <div className="settings-card">
                    <h2>Bill & Print Settings</h2>
                    <div className="form-group">
                        <label>Default GST Rate (Legacy)</label>
                        <input
                            type="number"
                            value={settings.gst_rate || 5}
                            onChange={(e) => handleBasicChange('gst_rate', e.target.value)}
                            step="0.1"
                        />
                        <span className="hint">Used as fallback if tax configuration is empty</span>
                    </div>

                    <div className="preview-receipt">
                        <h3>Receipt Preview</h3>
                        <div className="receipt-mock">
                            <div className="mock-line center"><strong>{settings.restaurant_name || brand.name}</strong></div>
                            <div className="mock-line center">GSTIN: {settings.gst_number || 'XXXXXXXXXXXXX'}</div>
                            {settings.fssai_number && <div className="mock-line center">FSSAI: {settings.fssai_number}</div>}
                            <div className="mock-line dashed"></div>
                            <div className="mock-line-flex"><span>Sample Item x1</span><span>₹60.00</span></div>
                            <div className="mock-line dashed"></div>
                            {taxConfig.map((t, i) => (
                                <div key={i} className="mock-line-flex"><span>{t.name} ({t.rate}%)</span><span>₹{(60 * t.rate / 100).toFixed(2)}</span></div>
                            ))}
                            <div className="mock-line-flex bold"><span>Total</span><span>₹{(60 * (1 + taxConfig.reduce((acc, t) => acc + t.rate, 0) / 100)).toFixed(2)}</span></div>
                        </div>
                    </div>
                </div>

                <DevicesCard canEdit={hasPerm('settings.edit')} />
            </div>
        </div>
    );
};

export default AdminSettings;
