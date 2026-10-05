import { mergeBrand, readBrandCache } from './brandStore';

// 80 mm thermal prints (kitchen ticket and bill) through the browser's print dialog.
// Works with any printer installed on the computer, including USB thermal printers.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Number(n || 0).toFixed(2);

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
      <table>${(order.items || []).map(i => `<tr><td class="big">${esc(i.quantity)} ×</td><td class="big">${esc(i.name)}</td></tr>
        ${i.note ? `<tr><td></td><td class="note">${esc(i.note)}</td></tr>` : ''}`).join('')}</table>
      ${order.specialInstructions ? `<hr><div class="b">Note: ${esc(order.specialInstructions)}</div>` : ''}
      <hr>`;
    open(page('KOT', body));
}

// Customer bill
export function printBill(order) {
    const r = order.restaurantInfo || {};
    const rows = (order.items || []).map(i => `<tr><td>${esc(i.name)}</td><td class="r">${esc(i.quantity)}</td><td class="r">${money(i.total)}</td></tr>`).join('');
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
