import React, { useState, useEffect } from 'react';
import './AnimatedSearchInput.css';
import brand from '../brand';

const placeholderTexts = brand.searchHints;

const AnimatedSearchInput = ({ value, onChange, onSubmit, className = '' }) => {
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const [displayText, setDisplayText] = useState('');
    const [isTyping, setIsTyping] = useState(true);

    useEffect(() => {
        const currentText = placeholderTexts[placeholderIndex];
        let charIndex = isTyping ? displayText.length : displayText.length;

        const timer = setTimeout(() => {
            if (isTyping) {
                if (charIndex < currentText.length) {
                    setDisplayText(currentText.slice(0, charIndex + 1));
                } else {
                    // Wait then start erasing
                    setTimeout(() => setIsTyping(false), 2000);
                }
            } else {
                if (charIndex > 0) {
                    setDisplayText(currentText.slice(0, charIndex - 1));
                } else {
                    // Move to next text
                    setPlaceholderIndex((prev) => (prev + 1) % placeholderTexts.length);
                    setIsTyping(true);
                }
            }
        }, isTyping ? 80 : 40);

        return () => clearTimeout(timer);
    }, [displayText, isTyping, placeholderIndex]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (onSubmit && value.trim()) {
            onSubmit(value);
        }
    };

    return (
        <form onSubmit={handleSubmit} className={`animated-search-form ${className}`}>
            <input
                type="text"
                placeholder={displayText}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="animated-search-input"
            />
        </form>
    );
};

export default AnimatedSearchInput;
