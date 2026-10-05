// The owner Setup checklist: what each step checks, and where it is fixed.
// `optional` steps only matter for some cafes (no GST, no table QR).
export const setupItems = (s, st) => {
    const unlinked = st?.staffUnlinked || [];
    return [
        { key: 'brand', title: 'Cafe name and logo', why: 'Shown on the customer app, bills, the Kiosk and the pickup TV.',
            done: !!s.restaurant_name && !!s.brand_logo, go: '/admin/brand', action: 'Open Brand & look' },
        { key: 'contact', title: 'Address and phone for bills', why: 'Printed at the top of every bill.',
            done: !!s.restaurant_address && !!s.restaurant_phone, go: '/admin/brand', action: 'Add address and phone' },
        { key: 'gst', title: 'GSTIN and FSSAI number', why: 'Printed on bills. Skip if the cafe is not GST registered.', optional: true,
            done: !!s.gst_number && !!s.fssai_number, go: '/admin/settings', action: 'Open Cafe settings' },
        { key: 'menu', title: 'Menu items', why: 'Nothing can be sold until the menu has items with prices.',
            done: (st?.menuItems || 0) > 0, go: '/admin/menu', action: 'Add menu items' },
        { key: 'tables', title: 'Tables and QR codes', why: 'Customers scan the table QR to order. Skip if you only sell at the counter.', optional: true,
            done: (st?.tables || 0) > 0, go: '/admin/tables', action: 'Add tables' },
        { key: 'staff', title: 'Staff logins', why: 'Each person logs in with their own mobile number and PIN.',
            done: (st?.staff || 0) > 0, go: '/admin/staff', action: 'Add staff' },
        { key: 'linked', title: 'Every staff login linked to an employee', why: unlinked.length
            ? `Not linked yet: ${unlinked.join(', ')}. They cannot check in until linked (Attendance → App login).`
            : 'Needed for check-in, attendance and payroll. New logins are linked automatically.',
            done: (st?.staff || 0) > 0 && unlinked.length === 0, go: '/admin/attendance', action: 'Open Attendance' },
        { key: 'geo', title: 'Cafe location for check-in', why: 'Staff can check in only when they are at the cafe.',
            done: s.geofence_lat !== null && s.geofence_lat !== undefined && s.geofence_lat !== '', go: '/admin/attendance#cafe-location', action: 'Set the location' },
        { key: 'shift', title: 'First cash shift', why: 'Open a shift with the cash in the drawer before the first sale.',
            done: (st?.shiftsEver || 0) > 0, go: '/admin/shifts', action: 'Open Cash & Shifts' },
        { key: 'push', title: 'Phone alerts', why: 'New orders ring on staff phones even when the app is closed. Needs the push key on the website (see RELEASES.md, Phase 5).',
            done: !!import.meta.env.VITE_VAPID_PUBLIC_KEY, go: '/admin/me', action: 'Turn on in My day', optional: true },
    ];
};
