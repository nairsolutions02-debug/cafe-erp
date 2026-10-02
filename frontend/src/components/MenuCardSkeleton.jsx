import React from 'react';
import './MenuCardSkeleton.css';

const MenuCardSkeleton = () => {
    return (
        <div className="menu-card-skeleton">
            <div className="skeleton-image shimmer"></div>
            <div className="skeleton-content">
                <div className="skeleton-title shimmer"></div>
                <div className="skeleton-price shimmer"></div>
                <div className="skeleton-button shimmer"></div>
            </div>
        </div>
    );
};

export default MenuCardSkeleton;
