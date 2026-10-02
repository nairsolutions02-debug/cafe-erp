import React from 'react';
import { getImageUrl } from '../utils/config';
import './CategoryCard.css';

const CategoryCard = ({ category, isActive, onClick }) => {
    const imageUrl = getImageUrl(category.image) || '/placeholder-food.svg';

    return (
        <div
            className={`category-card ${isActive ? 'active' : ''}`}
            onClick={() => onClick(category._id)}
        >
            <div className="category-image-wrapper">
                <img src={imageUrl} alt={category.name} className="category-image" />
            </div>
            <span className="category-name">{category.name}</span>
        </div>
    );
};

export default CategoryCard;
