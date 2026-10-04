// Ticket status and category names, shared by the cafe Help page and the platform console
export const STATUS = {
    open: { label: 'Open', hint: 'Waiting for N.A.I.R.' },
    working: { label: 'Working on it', hint: 'N.A.I.R. is on it' },
    waiting: { label: 'Needs your reply', hint: 'N.A.I.R. asked you something' },
    resolved: { label: 'Solved', hint: 'Reply if it is still not working' },
    closed: { label: 'Closed', hint: '' },
};
export const CATEGORIES = [
    { key: 'problem', label: 'Something is not working' },
    { key: 'question', label: 'How do I…?' },
    { key: 'idea', label: 'Idea / new feature' },
    { key: 'billing', label: 'Plan or payment' },
    { key: 'other', label: 'Other' },
];
export const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
