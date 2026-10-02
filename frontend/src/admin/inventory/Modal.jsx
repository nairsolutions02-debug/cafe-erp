import React from 'react';

// The admin modal shell (overlay, header with close, body; footer passed as children)
const Modal = ({ title, onClose, wide, children }) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
                <h2>{title}</h2>
                <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
            </div>
            {children}
        </div>
    </div>
);

export default Modal;
