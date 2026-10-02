// CSV/Excel Export Utility

/**
 * Convert data array to CSV string
 */
export const convertToCSV = (data, columns) => {
    if (!data || data.length === 0) return '';

    // Header row
    const header = columns.map(col => col.label).join(',');

    // Data rows
    const rows = data.map(row => {
        return columns.map(col => {
            let value = col.accessor(row);
            // Handle null/undefined
            if (value === null || value === undefined) value = '';
            // Escape quotes and wrap in quotes if contains comma
            if (typeof value === 'string') {
                value = value.replace(/"/g, '""');
                if (value.includes(',') || value.includes('\n') || value.includes('"')) {
                    value = `"${value}"`;
                }
            }
            return value;
        }).join(',');
    });

    return [header, ...rows].join('\n');
};

/**
 * Download CSV file
 */
export const downloadCSV = (csvContent, filename) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * Export data to CSV
 */
export const exportToCSV = (data, columns, filename) => {
    const csv = convertToCSV(data, columns);
    downloadCSV(csv, filename);
};

/**
 * Format date for filename
 */
export const getFilenameDate = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Format date to readable string
 */
export const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
};

/**
 * Customer export columns
 */
export const customerExportColumns = [
    { label: 'Name', accessor: (c) => c.name || 'No Name' },
    { label: 'Phone', accessor: (c) => c.phone || '-' },
    { label: 'Email', accessor: (c) => c.email || '-' },
    { label: 'Total Orders', accessor: (c) => c.paidOrders || 0 },
    { label: 'Total Spent (₹)', accessor: (c) => c.totalSpent || 0 },
    { label: 'Loyalty Points', accessor: (c) => c.loyaltyPoints || 0 },
    { label: 'Last Order Date', accessor: (c) => formatDate(c.lastOrderDate) },
    { label: 'Registration Date', accessor: (c) => formatDate(c.createdAt) }
];

/**
 * Order export columns
 */
export const orderExportColumns = [
    { label: 'Order ID', accessor: (o) => o.orderNumber || o._id?.slice(-8) || '-' },
    { label: 'Date', accessor: (o) => formatDate(o.createdAt) },
    { label: 'Customer Name', accessor: (o) => o.user?.name || 'Guest' },
    { label: 'Customer Phone', accessor: (o) => o.user?.phone || '-' },
    { label: 'Items', accessor: (o) => o.items?.map(i => `${i.name} x${i.quantity}`).join('; ') || '-' },
    { label: 'Subtotal (₹)', accessor: (o) => o.subtotal || 0 },
    { label: 'Discount (₹)', accessor: (o) => o.discount || 0 },
    { label: 'Tax (₹)', accessor: (o) => o.tax || 0 },
    { label: 'Total (₹)', accessor: (o) => o.total || 0 },
    { label: 'Payment Method', accessor: (o) => o.paymentMethod || '-' },
    { label: 'Status', accessor: (o) => o.status || '-' },
    { label: 'Table', accessor: (o) => o.table?.tableNumber ? `Table ${o.table.tableNumber}` : 'N/A' }
];

/**
 * Revenue export columns
 */
export const revenueExportColumns = [
    { label: 'Date', accessor: (r) => r.date || formatDate(r._id) },
    { label: 'Orders', accessor: (r) => r.orders || 0 },
    { label: 'Revenue (₹)', accessor: (r) => r.revenue?.toFixed(2) || 0 },
    { label: 'Profit (₹)', accessor: (r) => r.profit?.toFixed(2) || 0 }
];
