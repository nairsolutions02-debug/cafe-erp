import { mergeBrand, readBrandCache } from './brandStore';
import { supabase } from './supabase';

// 80 mm thermal prints (kitchen ticket and bill) through the browser's print dialog.
// Works with any printer installed on the computer, including USB thermal printers.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Number(n || 0).toFixed(2);

// A line's note holds its choices ("Oat, Hazelnut · extra hot"); a combo's note lists each pick
// ("Latte (Large) [Oat] + Croissant · no sugar"), printed one pick per row so the kitchen misses nothing
const isCombo = (i) => !!(i.comboId || i.combo_id || i.combo === true || i.options?.combo || (!i.menuItem && / \+ /.test(i.note || '')));
export function noteRows(i) {
    const note = String(i?.note || '').trim();
    if (!note) return [];
    if (!isCombo(i)) return [note];
    const at = note.lastIndexOf(' · ');
    const picks = (at >= 0 ? note.slice(0, at) : note).split(' + ').map(x => x.trim()).filter(Boolean).map(x => `+ ${x}`);
    return at >= 0 ? [...picks, note.slice(at + 3)] : picks;
}

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0; color: #000; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 4px; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
  .big { font-size: 20px; font-weight: bold; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 0; }
  .note { font-style: italic; padding-left: 8px; }
  .opt { font-size: 15px; font-weight: bold; padding-left: 4px; }
  .sub { font-size: 11px; padding-left: 8px; }
</style></head><body>${body}<script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}</script></body></html>`;

function open(html) {
    const w = window.open('', '_blank', 'width=380,height=640');
    if (!w) {
        alert('Allow pop-ups for this site to print.');
        return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
}

// Kitchen order ticket
export function printKot(order, { cafeName = '' } = {}) {
    // Shared tables: the customer's name tells the runner which group gets this ticket
    const who = order.tableNumber && order.user?.name ? ` · ${order.user.name.split(' ')[0]}` : '';
    const where = order.tableNumber ? `Table ${order.tableNumber}${who}` : order.tokenNumber ? `Token ${order.tokenNumber}` : (order.channel || '').replace('_', ' ');
    const body = `
      <div class="c b">KOT ${esc(cafeName)}</div>
      <div class="c big">${esc(where)}</div>
      <div class="c">${esc(order.orderNumber)} · ${new Date(order.createdAt || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="c">${esc((order.channel || '').replace('_', ' ').toUpperCase())}${order.staffName ? ' · ' + esc(order.staffName) : ''}</div>
      <hr>
      <table>${(order.items || []).map(i => `<tr><td class="big" style="white-space:nowrap;padding-right:4px">${esc(i.quantity)} ×</td><td class="big">${esc(i.name)}</td></tr>
        ${noteRows(i).map(n => `<tr><td></td><td class="opt">${esc(n)}</td></tr>`).join('')}`).join('')}</table>
      ${order.specialInstructions ? `<hr><div class="b">Note: ${esc(order.specialInstructions)}</div>` : ''}
      <hr>`;
    open(page('KOT', body));
}

// Customer bill. Every print is logged on the bill (count and who); a second print shows as a reprint in the day close.
export function printBill(order) {
    const id = order?._id || order?.id;
    if (id) supabase.rpc('log_bill_print', { p_order: id }).then(() => {}, () => {});
    const r = order.restaurantInfo || {};
    const rows = (order.items || []).map(i => `<tr><td>${esc(i.name)}${noteRows(i).map(n => `<div class="sub">${esc(n)}</div>`).join('')}</td><td class="r">${esc(i.quantity)}</td><td class="r">${money(i.total)}</td></tr>`).join('');
    const taxes = (order.taxDetails || []).map(t => `<tr><td>${esc(t.name)} ${esc(t.rate)}%</td><td></td><td class="r">${money(t.amount)}</td></tr>`).join('');
    const pays = (order.payments || []).map(p => `<tr><td>Paid ${esc(String(p.method).toUpperCase())}</td><td></td><td class="r">${money(p.amount)}</td></tr>`).join('');
    // The cafe logo (Settings → Brand & look), printed in grey; only an uploaded logo, never the standard one
    const brand = mergeBrand(readBrandCache());
    const logo = brand.logoIsCustom && /^https?:\/\//.test(brand.logo)
        ? `<div class="c"><img src="${esc(brand.logo)}" alt="" style="width:80px;height:80px;object-fit:contain;filter:grayscale(1)"></div>` : '';
    const body = `
      ${logo}
      <h1>${esc(r.name || brand.name)}</h1>
      ${r.address ? `<div class="c">${esc(r.address)}</div>` : ''}
      ${r.phone ? `<div class="c">Ph: ${esc(r.phone)}</div>` : ''}
      ${r.gstNumber ? `<div class="c">GSTIN: ${esc(r.gstNumber)}</div>` : ''}
      ${r.fssaiNumber ? `<div class="c">FSSAI: ${esc(r.fssaiNumber)}</div>` : ''}
      <hr>
      <div>Bill: ${esc(order.orderNumber)}</div>
      <div>${new Date(order.createdAt || Date.now()).toLocaleString('en-IN')}</div>
      ${order.tableNumber ? `<div>Table: ${esc(order.tableNumber)}</div>` : order.tokenNumber ? `<div>Token: ${esc(order.tokenNumber)}</div>` : ''}
      ${order.user?.name ? `<div>Customer: ${esc(order.user.name)}</div>` : ''}
      <hr>
      <table><tr class="b"><td>Item</td><td class="r">Qty</td><td class="r">Amt</td></tr>${rows}</table>
      <hr>
      <table>
        <tr><td>Subtotal</td><td></td><td class="r">${money(order.subtotal)}</td></tr>
        ${order.discount > 0 ? `<tr><td>Discount</td><td></td><td class="r">-${money(order.discount)}</td></tr>` : ''}
        ${taxes}
        ${order.serviceCharge > 0 ? `<tr><td>Service charge (optional)</td><td></td><td class="r">${money(order.serviceCharge)}</td></tr>
            <tr><td>GST on service charge</td><td></td><td class="r">${money(order.serviceChargeTax)}</td></tr>` : ''}
        ${order.roundOff ? `<tr><td>Round off</td><td></td><td class="r">${money(order.roundOff)}</td></tr>` : ''}
        <tr class="b"><td>TOTAL</td><td></td><td class="r big">${money(order.total)}</td></tr>
        ${pays}
      </table>
      <hr>
      <div class="c">${esc(r.footer || 'Thank you! Visit again.')}</div>`;
    open(page('Bill', body));
}

// Refund slip (credit note) for items given back from a paid bill
export function printRefundSlip(order, refund) {
    const r = order.restaurantInfo || {};
    const brand = mergeBrand(readBrandCache());
    const how = { cash: 'Cash', upi: 'UPI', card: 'Card', khata: 'Taken off khata' }[refund.method] || refund.method;
    const rows = (refund.lines || []).map(l => `<tr><td>${esc(l.name)}</td><td class="r">${esc(l.quantity)}</td><td class="r">${money(l.amount)}</td></tr>`).join('');
    const taxes = (refund.taxDetails || []).map(t => `<tr><td>${esc(t.name)} ${esc(t.rate)}%</td><td></td><td class="r">${money(t.amount)}</td></tr>`).join('');
    const body = `
      <h1>${esc(r.name || brand.name)}</h1>
      ${r.gstNumber ? `<div class="c">GSTIN: ${esc(r.gstNumber)}</div>` : ''}
      <div class="c b">REFUND SLIP (CREDIT NOTE)</div>
      <hr>
      <div>Bill: ${esc(order.orderNumber)} · refund ${esc(refund.number || '')}</div>
      <div>Bill date: ${new Date(order.createdAt || Date.now()).toLocaleDateString('en-IN')}</div>
      <div>Refund date: ${new Date(refund.at || Date.now()).toLocaleString('en-IN')}</div>
      ${order.user?.name ? `<div>Customer: ${esc(order.user.name)}</div>` : ''}
      <hr>
      <table><tr class="b"><td>Item returned</td><td class="r">Qty</td><td class="r">Amt</td></tr>${rows}</table>
      <hr>
      <table>
        <tr><td>Taxable value</td><td></td><td class="r">${money(Number(refund.taxable ?? 0) || (refund.lines || []).reduce((s, l) => s + Number(l.net || 0), 0) + Number(refund.serviceCharge || 0))}</td></tr>
        ${taxes}
        ${Number(refund.serviceCharge) > 0 ? `<tr><td>Service charge + GST</td><td></td><td class="r">${money(Number(refund.serviceCharge) + Number(refund.serviceChargeTax || 0))}</td></tr>` : ''}
        ${Number(refund.roundOff) ? `<tr><td>Round off</td><td></td><td class="r">${money(refund.roundOff)}</td></tr>` : ''}
        <tr class="b"><td>REFUNDED</td><td></td><td class="r big">${money(refund.amount)}</td></tr>
        <tr><td>By</td><td></td><td class="r">${esc(how)}</td></tr>
      </table>
      ${refund.reason ? `<div>Reason: ${esc(refund.reason)}</div>` : ''}
      <hr>
      <div class="c">Customer signature ______________</div>`;
    open(page('Refund', body));
}

// Shift balance sheet (Z-report) on the 80 mm printer: the bills of the shift, money not from bills, expected vs counted
export function printZReport(shift) {
    const bal = shift?.balance;
    if (!bal) return;
    const b = bal.bills || {};
    const c = bal.cash || {}; const u = bal.upi || {}; const k = bal.card || {};
    const row = (l, v, cls = '') => `<tr class="${cls}"><td>${esc(l)}</td><td class="r">${money(v)}</td></tr>`;
    const opt = (l, v, cls = '') => (Number(v || 0) !== 0 ? row(l, v, cls) : '');
    const diff = (exp, cnt) => (cnt == null ? '—' : money(Number(cnt) - Number(exp)));
    const brand = mergeBrand(readBrandCache());
    const when = (d) => (d ? new Date(d).toLocaleString('en-IN') : '');
    const body = `
      <h1>${esc(brand.name)}</h1>
      <div class="c b">SHIFT BALANCE SHEET (Z-REPORT)</div>
      <div class="c">${esc(shift.drawerName)}</div>
      <hr>
      <div>Opened: ${esc(when(shift.openedAt))} · ${esc(shift.openedBy)}</div>
      ${shift.closedAt ? `<div>Closed: ${esc(when(shift.closedAt))} · ${esc(shift.closedBy)}</div>` : '<div class="b">Shift still open</div>'}
      <hr>
      <table>
        ${row(`Bills made (${b.madeCount || 0})`, b.madeTotal, 'b')}
        ${opt(`Received from last shift (${b.receivedCount || 0})`, b.receivedTotal, 'b')}
        <tr><td colspan="2">=</td></tr>
        ${row('Paid cash', b.paidCash)}${row('Paid UPI', b.paidUpi)}${row('Paid card', b.paidCard)}
        ${opt('Khata', b.khata)}${opt('UPI online', b.online)}${opt('Paid at another drawer', b.otherDrawer)}
        ${opt(`Cancelled (${b.cancelledCount || 0})`, b.cancelled)}${opt('Refunded', b.refunded)}
        ${opt(`Handed over (${b.handedCount || 0})`, b.handedOver)}${opt(`Still open (${b.openCount || 0})`, b.open)}
      </table>
      <div class="c b">${bal.balanced ? 'BILLS ADD UP' : `NOT BALANCED: OFF BY ${money(bal.difference)}`}</div>
      <hr>
      <div class="b">Money not from bills</div>
      <table>
        ${opt('Khata collected cash', c.khata)}${opt('Khata collected UPI', u.khata)}${opt('Khata collected card', k.khata)}
        ${opt('From safe', c.payIns)}${opt('Pay-outs', -Number(c.payouts || 0))}${opt('Expenses', -Number(c.expenses || 0))}
        ${opt('To safe / office', -Number(c.drops || 0))}${opt('Other bills (cash)', c.otherBills)}${opt('Other bills (UPI)', u.otherBills)}
        ${opt('Other bills (card)', k.otherBills)}
      </table>
      <hr>
      <table>
        <tr class="b"><td>Money</td><td class="r">Expected</td><td class="r">Counted</td><td class="r">Diff</td></tr>
        <tr><td>Cash</td><td class="r">${money(c.expected)}</td><td class="r">${c.counted == null ? '—' : money(c.counted)}</td><td class="r">${diff(c.expected, c.counted)}</td></tr>
        <tr><td>UPI</td><td class="r">${money(u.expected)}</td><td class="r">${u.counted == null ? '—' : money(u.counted)}</td><td class="r">${diff(u.expected, u.counted)}</td></tr>
        <tr><td>Card</td><td class="r">${money(k.expected)}</td><td class="r">${k.counted == null ? '—' : money(k.counted)}</td><td class="r">${diff(k.expected, k.counted)}</td></tr>
      </table>
      ${shift.varianceApprovedBy ? `<div>Approved by: ${esc(shift.varianceApprovedBy)}</div>` : ''}
      ${shift.reason ? `<div>Reason: ${esc(shift.reason)}</div>` : ''}
      <hr>
      <div>Counted by: ____________</div>
      <div>Checked by: ____________</div>`;
    open(page('Shift balance sheet', body));
}

// Owner day close on A4: the day equation, money by kind, every drawer and the exceptions
export function printDayClose(r) {
    if (!r) return;
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { alert('Allow pop-ups for this site to print.'); return; }
    const m = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const c = r.combined || {};
    const tr = (cells, tag = 'td') => `<tr>${cells.map(x => `<${tag}>${esc(x)}</${tag}>`).join('')}</tr>`;
    const list = (title, rows, cols) => (rows?.length ? `<h3>${esc(title)} (${rows.length})</h3><table>${tr(cols.map(x => x[0]), 'th')}${rows.map(x => tr(cols.map(([, f]) => f(x)))).join('')}</table>` : '');
    const brand = mergeBrand(readBrandCache());
    const days = r.from === r.to ? r.from : `${r.from} to ${r.to}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Day close ${esc(days)}</title><style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #000; margin: 16mm; }
      h1 { font-size: 18px; margin: 0; } h2 { font-size: 14px; margin: 16px 0 6px; } h3 { font-size: 12px; margin: 12px 0 4px; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 6px; } td, th { border: 1px solid #999; padding: 3px 6px; text-align: left; }
      th { background: #eee; } .ok { color: #11602f; font-weight: bold; } .bad { color: #a01010; font-weight: bold; }
    </style></head><body>
      <h1>${esc(brand.name)} · Day close ${esc(days)}</h1>
      <p class="${r.status?.balanced ? 'ok' : 'bad'}">${r.status?.balanced ? 'BALANCED' : `NOT BALANCED: ${esc((r.status?.reasons || []).join('; '))}`}
      ${r.closed?.status === 'closed' ? ` · Closed by ${esc(r.closed.by)} on ${esc(new Date(r.closed.at).toLocaleString('en-IN'))}` : ''}</p>
      <h2>Bills (all drawers and QR / online)</h2>
      <table>
        ${tr(['Bills made', `${c.madeCount || 0}`, m(c.madeTotal)])}
        ${Number(c.receivedBefore) ? tr(['Received from an earlier day', '', m(c.receivedBefore)]) : ''}
        ${tr(['Paid cash', '', m(c.paidCash)])}${tr(['Paid UPI at drawers', '', m(c.paidUpi)])}${tr(['UPI online', '', m(c.upiOnline)])}
        ${tr(['Paid card', '', m(c.paidCard)])}${tr(['Aggregator', '', m(c.aggregator)])}${tr(['Khata', '', m(c.khata)])}
        ${tr(['Cancelled', '', m(c.cancelled)])}${tr(['Refunded', '', m(c.refunded)])}
        ${tr(['Handed over (still open at the end)', '', m(c.handedOver)])}${tr(['Still open', `${c.openCount || 0}`, m(c.open)])}
        ${tr(['Difference', '', m(c.difference)])}
      </table>
      <h2>Money by kind</h2>
      <table>${tr(['Money', 'Expected', 'Counted', 'Difference'], 'th')}
        ${tr(['Cash (all drawers)', m(r.modes?.cash?.expected), m(r.modes?.cash?.counted), m(r.modes?.cash?.difference)])}
        ${tr(['UPI at drawers', m(r.modes?.upi?.expected), m(r.modes?.upi?.counted), m(r.modes?.upi?.difference)])}
        ${tr(['UPI online', m(r.modes?.upi?.online), 'UPI statement', ''])}
        ${tr(['Card', m(r.modes?.card?.expected), m(r.modes?.card?.counted), m(r.modes?.card?.difference)])}
      </table>
      <p>Total difference: <b>${m(r.money?.totalVariance)}</b> · Cash to the office / safe: <b>${m(r.money?.cashToOffice)}</b></p>
      <h2>Drawers</h2>
      <table>${tr(['Drawer', 'Shifts', 'Bills made', 'Cash expected', 'Cash counted', 'UPI', 'Card'], 'th')}
        ${(r.drawers || []).map(d => tr([d.name, `${d.shifts}`, m(d.bills?.madeTotal), m(d.cash?.expected), m(d.cash?.counted), m(d.upi?.expected), m(d.card?.expected)])).join('')}
        ${tr(['QR / online (no drawer)', '', m(r.qr?.madeTotal), '', '', m(r.qr?.online), ''])}
      </table>
      <h2>Exceptions</h2>
      ${list('Open bills', r.exceptions?.openBills, [['Bill', x => x.orderNumber], ['Due', x => m(x.due)], ['Where', x => x.drawerName || x.channel]])}
      ${list('Handed over', r.exceptions?.handedOver, [['Bill', x => x.orderNumber], ['Due', x => m(x.due)], ['By', x => x.by], ['Approved by', x => x.approvedBy], ['Reason', x => x.reason], ['Now', x => x.billStatus]])}
      ${list('Differences at close', r.exceptions?.variances, [['Drawer', x => x.drawerName], ['Cash', x => m(x.cash)], ['UPI', x => m(x.upi)], ['Card', x => m(x.card)], ['Approved by', x => x.approvedBy], ['Reason', x => x.reason]])}
      ${list('Cancelled after the kitchen started', r.exceptions?.voidsAfterKitchen, [['Bill', x => x.orderNumber], ['Amount', x => m(x.total)], ['Reason', x => x.reason]])}
      ${list('Refunds', r.exceptions?.refunds, [['Bill', x => x.orderNumber], ['Amount', x => m(x.amount)], ['How', x => x.method], ['Reason', x => x.reason], ['By', x => x.by]])}
      ${list('Discounts by hand', r.exceptions?.discounts, [['Bill', x => x.orderNumber], ['Amount', x => m(x.amount)], ['%', x => `${x.pct ?? ''}`], ['Reason', x => x.reason], ['Approved by', x => x.approvedBy]])}
      ${list('Reprints', r.exceptions?.reprints, [['Bill', x => x.orderNumber], ['Prints', x => `${x.prints}`], ['By', x => x.by]])}
      ${list('Shifts still open', r.exceptions?.openShifts, [['Drawer', x => x.drawerName], ['Opened by', x => x.openedBy]])}
      <p style="margin-top:24px">Owner signature: ______________________</p>
      <script>window.onload=function(){window.print()}</script></body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
}
