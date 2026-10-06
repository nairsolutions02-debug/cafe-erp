import React from 'react';
import Art from './cx/Art';
import { artFor } from './cx/artKinds';
import useCxLang from '../lib/cxLang';
import './CategoryCard.css';

// A category as a round chip with a small drawn picture (Home and Menu)
const CategoryCard = ({ category, isActive, onClick }) => {
    const { lang } = useCxLang();
    const name = lang === 'hi' && category.nameHi ? category.nameHi : category.name;
    return (
        <button type="button" className={`cx-chip cx-glass category-card ${isActive ? 'on' : ''}`} aria-pressed={!!isActive}
            onClick={() => onClick(category._id)}>
            <Art kind={category.art || artFor({ name: category.name })} />
            <span className="category-name">{name}</span>
        </button>
    );
};

export default CategoryCard;
