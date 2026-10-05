import React from 'react';
import './OrderBill.css';
import { FiCheck, FiX, FiFileText } from 'react-icons/fi';
import { useBrand } from '../context/BrandContext';

const OrderBill = ({ order, orders, onCancel }) => {
    const brand = useBrand();
    // Determine the list of orders to display
    const ordersList = orders || (order ? [order] : []);

    if (ordersList.length === 0) return null;

    const handlePrint = () => {
        window.print();
    };

    // Use restaurant info from the first order or defaults
    const restaurant = ordersList[0].restaurantInfo || {
        name: brand.name,
        address: brand.address,
        phone: brand.phone,
        gstNumber: ""
    };

    // Aggregate totals
    const aggregated = ordersList.reduce((acc, curr) => {
        acc.subtotal += (curr.subtotal || 0);
        acc.discount += (curr.discount || 0);
        acc.tax += (curr.tax || 0);
        acc.total += (curr.total || 0);
        acc.serviceCharge += (curr.serviceCharge || 0);
        acc.serviceChargeTax += (curr.serviceChargeTax || 0);
        acc.roundOff += (curr.roundOff || 0);
        (curr.payments || []).forEach(p => {
            const existing = acc.payments.find(x => x.method === p.method);
            if (existing) existing.amount += p.amount; else acc.payments.push({ ...p });
        });

        // Items
        if (curr.items) {
            curr.items.forEach(item => {
                acc.items.push(item);
            });
        }

        // Tax details aggregation could be complex, for now sum them up if names match
        if (curr.taxDetails) {
            curr.taxDetails.forEach(t => {
                const existing = acc.taxDetails.find(x => x.name === t.name);
                if (existing) {
                    existing.amount += t.amount;
                } else {
                    acc.taxDetails.push({ ...t });
                }
            });
        }
        return acc;
    }, { subtotal: 0, discount: 0, tax: 0, total: 0, serviceCharge: 0, serviceChargeTax: 0, roundOff: 0, payments: [], items: [], taxDetails: [] });

    // Consolidate items by ID/name to show quantities neatly
    const consolidatedItems = {};
    aggregated.items.forEach(item => {
        const id = item.menuItem?._id || item.menuItem || item.name; // Fallback key
        if (consolidatedItems[id]) {
            consolidatedItems[id].quantity += item.quantity;
            consolidatedItems[id].total += (item.total || (item.price * item.quantity));
        } else {
            consolidatedItems[id] = {
                ...item,
                total: (item.total || (item.price * item.quantity))
            };
        }
    });
    const finalItems = Object.values(consolidatedItems);

    const mainOrder = ordersList[0];

    return (
        <div className="bill-modal-overlay" onClick={onCancel}>
            <div className="bill-container print-bill-overlay" onClick={e => e.stopPropagation()}>
                <div className="bill-header">
                    <h2>{restaurant.name}</h2>
                    <p>{brand.tagline}</p>
                    <p>{restaurant.address}</p>
                    <p>Ph: {restaurant.phone}</p>
                    {restaurant.gstNumber && <p>GSTIN: {restaurant.gstNumber}</p>}
                    {restaurant.fssaiNumber && <p>FSSAI: {restaurant.fssaiNumber}</p>}
                </div>

                <div className="bill-info">
                    <div className="bill-info-row">
                        <span>Bill No: {mainOrder.orderNumber} {ordersList.length > 1 ? `(+${ordersList.length - 1} others)` : ''}</span>
                        <span>Date: {new Date(mainOrder.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="bill-info-row">
                        <span>Time: {new Date(mainOrder.createdAt).toLocaleTimeString()}</span>
                        {mainOrder.tableNumber && <span>Table: {mainOrder.tableNumber}</span>}
                    </div>
                    <div className="bill-info-row">
                        <span>Cust: {mainOrder.user?.name || 'Walk-in'}</span>
                        <span>{mainOrder.user?.phone || ''}</span>
                    </div>
                </div>

                <div className="bill-divider"></div>

                <div className="bill-items-header">
                    <span>Item Name</span>
                    <span className="qty">Qty</span>
                    <span className="total">Amount</span>
                </div>

                <div className="bill-items">
                    {finalItems.map((item, index) => (
                        <div key={index} className="bill-item">
                            <span>{item.name || item.menuItem?.name || 'Item'}</span>
                            <span className="qty">{item.quantity}</span>
                            <span className="total">₹{((item.price || 0) * (item.quantity || 1)).toFixed(2)}</span>
                        </div>
                    ))}
                </div>

                <div className="bill-divider"></div>

                <div className="bill-totals">
                    <div className="bill-total-row">
                        <span>Subtotal</span>
                        <span>₹{aggregated.subtotal.toFixed(2)}</span>
                    </div>
                    {aggregated.discount > 0 && (
                        <div className="bill-total-row">
                            <span>Discount</span>
                            <span>- ₹{aggregated.discount.toFixed(2)}</span>
                        </div>
                    )}

                    {/* Render detailed taxes if available, otherwise fallback to generic Tax */}
                    {aggregated.taxDetails.length > 0 ? (
                        aggregated.taxDetails.map((t, i) => (
                            <div key={i} className="bill-total-row">
                                <span>{t.name} ({t.rate}%)</span>
                                <span>₹{(t.amount || 0).toFixed(2)}</span>
                            </div>
                        ))
                    ) : (
                        <div className="bill-total-row">
                            <span>Tax (5%)</span>
                            <span>₹{(aggregated.tax || 0).toFixed(2)}</span>
                        </div>
                    )}

                    {aggregated.serviceCharge > 0 && (
                        <>
                            <div className="bill-total-row">
                                <span>Service charge (optional)</span>
                                <span>₹{aggregated.serviceCharge.toFixed(2)}</span>
                            </div>
                            <div className="bill-total-row">
                                <span>GST on service charge</span>
                                <span>₹{aggregated.serviceChargeTax.toFixed(2)}</span>
                            </div>
                        </>
                    )}
                    {Math.abs(aggregated.roundOff) > 0.001 && (
                        <div className="bill-total-row">
                            <span>Round off</span>
                            <span>₹{aggregated.roundOff.toFixed(2)}</span>
                        </div>
                    )}

                    <div className="bill-total-row grand-total">
                        <span>GRAND TOTAL</span>
                        <span>₹{aggregated.total.toFixed(2)}</span>
                    </div>
                </div>

                <div className="bill-footer">
                    {aggregated.payments.length > 0
                        ? aggregated.payments.map(p => <p key={p.method}>Paid {p.method.toUpperCase()}: ₹{p.amount.toFixed(2)}</p>)
                        : <p>Payment: {mainOrder.paymentMethod?.toUpperCase() || 'NOT PAID'}</p>}
                    <p>{restaurant.footer || 'Thank you for visiting! Visit again soon!'}</p>
                </div>

                <div className="bill-actions">
                    <button className="btn-print" onClick={handlePrint}>Print Bill</button>
                    <button className="btn-close" onClick={onCancel}>Close</button>
                </div>
            </div>
        </div>
    );
};

export default OrderBill;
