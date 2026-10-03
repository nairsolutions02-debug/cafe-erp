// Download rows as a CSV file (opens in Excel / Google Sheets)
export function downloadCsv(filename, header, rows) {
    const cell = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = [header, ...rows].map(r => r.map(cell).join(',')).join('\n');
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// Read CSV text into rows of cells (quotes, commas and new lines inside quotes; ; or tab separated files too)
export function parseCsv(text) {
    const src = String(text || '').replace(/^﻿/, '');
    const first = src.split(/\r?\n/, 1)[0] || '';
    const sep = [',', ';', '\t'].reduce((best, s) => (first.split(s).length > first.split(best).length ? s : best), ',');
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === sep) { row.push(cell.trim()); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(cell.trim()); cell = '';
            if (row.some(c => c !== '')) rows.push(row);
            row = [];
        } else cell += ch;
    }
    row.push(cell.trim());
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
}
