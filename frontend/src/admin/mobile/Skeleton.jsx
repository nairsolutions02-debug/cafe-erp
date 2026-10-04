import React from 'react';
import './mobile.css';

// Grey placeholder cards while a staff page loads (instead of a spinner over the whole screen)
const Skeleton = ({ rows = 4, label = 'Loading' }) => (
    <div className="skel" role="status" aria-label={label}>
        <div className="skel-line w40" />
        {Array.from({ length: rows }, (_, i) => <div key={i} className="skel-card" />)}
    </div>
);

export default Skeleton;
