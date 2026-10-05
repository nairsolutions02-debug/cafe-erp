import React from 'react';
import { FiEye } from 'react-icons/fi';

// Shown on pages a person can open but not change, so the missing buttons are not a surprise
const ViewOnlyNote = ({ what = 'change this page' }) => (
    <p className="view-only-note" role="note"><FiEye /> You can look; ask the owner if you need to {what}.</p>
);

export default ViewOnlyNote;
