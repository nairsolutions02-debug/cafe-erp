import React, { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext();

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children }) => {
    const [items, setItems] = useState(() => {
        const saved = localStorage.getItem('cart');
        return saved ? JSON.parse(saved) : [];
    });
    const [coupon, setCoupon] = useState(null);

    useEffect(() => {
        localStorage.setItem('cart', JSON.stringify(items));
    }, [items]);

    const addItem = (item) => {
        setItems(prev => {
            const existing = prev.find(i => i._id === item._id);
            if (existing) {
                return prev.map(i =>
                    i._id === item._id
                        ? { ...i, quantity: i.quantity + 1 }
                        : i
                );
            }
            return [...prev, { ...item, quantity: 1 }];
        });
    };

    const removeItem = (itemId) => {
        setItems(prev => prev.filter(i => i._id !== itemId));
    };

    const updateQuantity = (itemId, quantity) => {
        if (quantity <= 0) {
            removeItem(itemId);
            return;
        }
        setItems(prev =>
            prev.map(i => i._id === itemId ? { ...i, quantity } : i)
        );
    };

    const incrementQuantity = (itemId) => {
        setItems(prev =>
            prev.map(i => i._id === itemId ? { ...i, quantity: i.quantity + 1 } : i)
        );
    };

    const decrementQuantity = (itemId) => {
        setItems(prev => {
            const item = prev.find(i => i._id === itemId);
            if (item && item.quantity <= 1) {
                return prev.filter(i => i._id !== itemId);
            }
            return prev.map(i =>
                i._id === itemId ? { ...i, quantity: i.quantity - 1 } : i
            );
        });
    };

    const clearCart = () => {
        setItems([]);
        setCoupon(null);
    };

    const applyCoupon = (couponData) => {
        setCoupon(couponData);
    };

    const removeCoupon = () => {
        setCoupon(null);
    };

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discount = coupon ? coupon.discount : 0;
    const tax = (subtotal - discount) * 0.05;
    const total = subtotal - discount + tax;
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <CartContext.Provider value={{
            items,
            coupon,
            subtotal,
            discount,
            tax,
            total,
            itemCount,
            addItem,
            removeItem,
            updateQuantity,
            incrementQuantity,
            decrementQuantity,
            clearCart,
            applyCoupon,
            removeCoupon
        }}>
            {children}
        </CartContext.Provider>
    );
};
