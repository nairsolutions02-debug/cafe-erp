# Cafe ERP — Release log

Newest first. Each release lists what changed, how to deploy it, and a checklist to test on the live site.

---

## Phase 4 — Reports and payroll (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Reports (`/admin/reports`) | **Profit & loss** for any period (this week, this month, last month, last 30 days, custom) next to the previous period with % change: sales by channel → GST → net sales → cost of goods (recipe/cost snapshot per order line) → gross profit → wastage and count losses → staff cost → expenses by category → net profit. Every line has a **Why?** with the formula and where the numbers come from. Needs *See profit*. |
| Spread costs | An expense spread over several months (e.g. a yearly licence, a big electricity bill) counts a share per day, so one day's profit isn't distorted. One-month expenses count on their date. |
| Staff cost | From finalized payroll; months without one use each active employee's salary as an **estimate** (labelled). |
| Cash flow | Per money account: opening + in − out = closing. |
| Profit target | Weekly and monthly ₹ targets with a progress bar and a straight-line **forecast** for the period end. |
| Item profit | Every item sold: units, net sales, cost, contribution (₹ and %), per unit, share of total profit, trend vs the previous period; "cost unknown" flag for items without a recipe or cost. |
| GST pack | Sales by GST rate (taxable, CGST, SGST), HSN/SAC summary (new *HSN code* on menu items; blank = SAC 996331), purchases with vendor GSTIN, bill number range; each downloads as CSV for the CA. **Due dates** for monthly, quarterly (QRMP) or composition filing, with a bell reminder 3 days before. |
| Payroll (`/admin/payroll`) | Per employee pay type (**monthly / daily / hourly**), OT rate, shift hours, weekly off (Employees → Edit). **Run payroll** for a month from attendance: present, half-days (½), paid leave, holidays, weekly offs; overtime beyond the shift; advance instalment and approved penalties deducted. **Finalize**, then **Pay all** (or one) from Bank/Cash/UPI — each salary is a money-ledger entry. Printable **payslip** (Save as PDF). |
| Leave | Leave types (Casual 8, Sick 6, Earned 12, Unpaid) with yearly quotas; requests → approve/reject (marks attendance as leave) → balances per employee. |
| Advances & penalties | Give an advance (from any account, recovered per month); add a penalty (late, breakage) which a **second person** must approve; both appear on the payslip. |
| Privacy | Salary, wage and OT rates are hidden from anyone without *See salaries*; payroll needs it too. |

**Deploy**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-phase4.sql`** → Run → *Success*.
2. Vercel redeploys from `main`.

**Test checklist**

- [ ] Reports → Profit & loss → *This month*: sales by channel, net sales, cost of goods, gross profit, net profit; tap **Why?** on a few lines
- [ ] Finance → Expenses → add a ₹12,000 *Licences* expense spread over 12 months → P&L for this month shows only its share
- [ ] Reports → Profit target → set a monthly target → progress bar and forecast
- [ ] Reports → Item profit → items with contribution and share; an item without recipe shows *cost unknown*
- [ ] Reports → GST → pick *Last month* → sales by rate + HSN; download the three CSVs; set the filing type; due dates update
- [ ] Menu → an item → *HSN code* (e.g. packaged drink 2202) → it appears in the HSN summary
- [ ] Employees → Edit → pay type, OT rate, shift hours, weekly off → Save
- [ ] Payroll → last month → **Run payroll** → check present / half / leave / offs / OT per person → **Finalize** → **Pay all** from Bank → Finance → Money ledger shows salary lines
- [ ] Payroll → payslip printer icon → print / Save as PDF
- [ ] Payroll → Leave → add a request → **Approve** → balance goes up by 1 used; the day shows as leave in attendance
- [ ] Payroll → Advances & penalties → give ₹3,000 advance (₹1,000/month) → next payroll deducts ₹1,000; add a penalty → another manager approves → deducted
- [ ] Cashier login → no Reports, Finance or Payroll; Accountant → can see Reports and Payroll but not run payroll

**Known limits in this release**

- PF/ESI are not calculated (off until the cafe crosses the thresholds; the CA confirms them).
- Incentives on payslips arrive with Phase 6 (incentive rules).
- Tally export isn't included; the CSVs open in Excel for the CA.

---

## Phase 3 — Kiosk and khata (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Kiosk (`/admin/kiosk`) | Fast screen for a phone or tablet: **customer tabs** across the top (Guest 1 · Raju · +) so several people can be served at once; customer by phone digits or name, regulars as one-tap chips (with khata due); big tiles, most sold at the kiosk first, with **pieces left** at the kiosk and an amber bar when low; brand/category chips. Tap = +1 piece; **hold** (long-press) for a number pad with **Piece / Pack**. One tap on **Cash · UPI · Khata** settles the tab and moves to the next waiting customer. A regular buying 2 cigarettes on khata took under 1 second of taps in testing. |
| Kiosk stock and cash | Kiosk sales take stock from the location marked *Kiosk sells from here* (Inventory → Locations) and cash goes to the **Cash – Kiosk** drawer with its own shift. Kiosk sales never go to the kitchen screen. Works offline like the counter (code K1). |
| Restricted items | "Customer looks under 18? Check ID" shows when a restricted item is in the cart (Settings key `restricted_id_reminder`). Restricted items still earn no points or offers. |
| Khata | Per-customer **credit limit** (Khata page → Limit; 0 = no credit). A sale beyond the limit needs a manager's mobile + PIN (new permission *Approve khata over the limit*; Managers have it). Balances come from the money ledger (Khata account), so cancelling a khata sale takes it off automatically. |
| Khata page (`/admin/khata`) | Who owes what, **oldest unpaid** in days (first-in-first-out), aging 0–7 / 8–15 / 16–30 / 30+, **Collect** (cash into a drawer, UPI or card), **WhatsApp** reminder with the amount pre-filled, full history. Once a day the bell shows "N khata accounts due over 7 days" (Settings key `khata_reminder_days`). |
| Low stock per location | Inventory → Stock → Edit → *Low-stock level at one location* (e.g. Kiosk: 20 pc of Gold Flake) drives the amber bar on kiosk tiles. |
| Plans | Kiosk devices count against the plan (Starter 0, Pro 1, Business 3, Custom 5). Set the plan in /superadmin before using the kiosk. |

**Deploy**

1. Supabase → SQL Editor → paste **`supabase/upgrades/2026-10-phase3.sql`** → Run → *Success*.
2. /superadmin → FiKA → make sure the plan allows at least 1 kiosk (Custom allows 5).
3. Vercel redeploys from `main`.

**Test checklist**

- [ ] Inventory → Locations: *Kiosk sells from here* is ticked on **Kiosk**
- [ ] Recipes → Gold Flake (or any resale item) → *Track it as its own stock item*; Menu → its Pack units → *Pack = 10*, sale price ₹190
- [ ] Purchases → buy 100 pc, *Received at* **Kiosk** → kiosk tile shows "100 left"
- [ ] Cash & Shifts → **Cash – Kiosk** → Open shift
- [ ] Khata → search a regular's phone → **Limit** ₹500
- [ ] Kiosk: type 4 digits of the regular's phone → pick → tap the cigarette twice → "Check ID" banner → **Khata** → green confirmation; tile drops by 2
- [ ] Kiosk: **+** tab → hold the cigarette tile → Pack → 1 → Add; **+** another tab → Mint; go back to the pack tab → **Cash**; it jumps to the Mint tab → **UPI**
- [ ] Kiosk: put the regular over their limit → asks for manager mobile + PIN → approved sale goes through
- [ ] Khata page: the regular shows the due amount and *0 days* → **Collect** by UPI → due drops; **History** lists the sale and the payment; **WhatsApp** opens with the message pre-filled
- [ ] Cash & Shifts → Kiosk drawer shows cash expected = opening + kiosk cash sales; close it
- [ ] Orders → cancel a khata sale (reason) → the khata due goes down
- [ ] Phone (portrait): kiosk tiles and the Cash/UPI/Khata bar fit without sideways scrolling

**Known limits in this release**

- The kiosk lists every available menu item (most sold at the kiosk first). Use the brand/category chips to narrow it.
- A khata limit check for an offline sale happens when it syncs; if the limit is exceeded then, the sale shows under *failed* in the sync pill for a manager to retry with approval.

---

## Phase 2 — Counter, kitchen, offline and money (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Counter (`/admin/pos`) | Fast billing screen: tap tiles (Enter in search adds the first match), takeaway or dine-in (table or token), optional customer by mobile, line notes, pack sizes (e.g. Box of 6 at the box price), discount with reason. **Pay** by cash (quick notes + change), UPI, card or split; or **Send to kitchen** and pay later. |
| Offline | The counter keeps working without internet: the menu is stored on the device, sales get numbers like `C1-261003-0007` (device code + date + count), and a pill shows *Offline · 3 waiting to sync*. They sync in order when the internet returns and are stored exactly once. Failed ones show with Retry. Expenses and drawer pay-outs work offline too. |
| Discounts & voids | Each person's discount limit comes from their role (Cashier 10%, Kiosk 5%, Manager 100%; editable as `max_discount_pct`). Above the limit, a manager types their mobile + PIN at the counter. Cancelling an order needs a reason; people without *Cancel / void orders* need a manager PIN. Paid money is refunded to where it came from. Cancels after the kitchen started are flagged and alert the owner. |
| Kitchen (`/admin/kitchen`) | One ticket per order with table/token, age (amber 10 min, red 20 min), line notes. Tap a line to move it queued → preparing → ready; *All ready* / *Served*. New orders beep. Works on any tablet or TV (Full screen). |
| Printing | 80 mm **KOT** and **bill** printing from the counter, kitchen and orders board through the browser print dialog (works with the USB thermal printer). Optional auto-print KOT. |
| Customer payment | After being served, the customer taps **Pay at the counter** or **Pay by UPI at my table**. Staff get a **full-screen alarm** with sound ("Table 4 wants to pay ₹640 by UPI") until someone taps Acknowledge. |
| Orders board | **Take payment** (cash with change, UPI, card, split; remove the optional service charge), **Cancel** with reason/manager PIN, **KOT** and thermal **Print**, channel/token/staff on every card. |
| Cash & Shifts (`/admin/shifts`) | Open each drawer (Counter, Kiosk) with a note-by-note count. During the shift: pay-outs (optionally recorded as an expense), cash to/from the safe. Close with a count, UPI-app and card-machine totals: shows expected vs counted. A difference above the tolerance (Settings, default ₹50) needs a reason and alerts the owner. |
| Money ledger | Every rupee is one line: sales, refunds, pay-outs, drops, expenses, vendor payments. Never edited; mistakes are reversed. Accounts: Cash – Counter, Cash – Kiosk, Cash – Office/safe, UPI, Card, Bank, Khata. |
| Finance (`/admin/finance`) | **Today** (sales, GST, discounts, unpaid, cancels, money in/out by account, channels, expenses, shifts, voids and discounts list), **Money ledger**, **Expenses** (categories, bill photo, paid now or later, spread over months, cancel with reason, monthly bills like rent), **Payables** (vendor bills aged 0–7/8–15/16–30/30+ days, bills due, pay from any account), **Accounts** (balances). Vendor payments from purchases now go through the ledger. |
| Bill settings | Settings: optional **service charge %** (off by default; shown as optional with its GST, removable), **round-off**, **bill footer**, shift cash tolerance. |
| Alerts | Bell in the admin header with recent alerts (payment requests, cash mismatches, voids after kitchen). |
| Roles | New permission module **Finance** (Manager: view/create/edit; Accountant: view). Cashiers now land on the Counter. |

**Deploy**

1. Supabase → SQL Editor → New query → paste **`supabase/upgrades/2026-10-phase2.sql`** → Run → *Success*.
2. Vercel redeploys from `main` (~1 min).
3. On the billing computer: Chrome → print dialog → choose the thermal printer, paper 80 mm, margins *None*, untick *Headers and footers* once; Chrome remembers it.

**Test checklist**

- [ ] **Cash & Shifts** → Counter → Open shift → count notes (e.g. ₹500×2, ₹100×5) → shows ₹1,500
- [ ] **Counter** → 2 coffees + 1 snack, Takeaway → total with GST → Pay → ₹500 → change shown → Paid → popup prints the KOT/bill (allow pop-ups once)
- [ ] Dine-in → pick a table → item note "less sugar" → Send to kitchen
- [ ] **Kitchen** → ticket shows table + note → tap the line (preparing → ready) → All ready → Served → ticket disappears
- [ ] Counter: discount 50% with reason as a Cashier → asks for manager mobile + PIN → manager approves → saved; Finance → Today lists it with who approved
- [ ] Offline: switch off Wi-Fi on the counter device → sale → pill shows *Offline · 1 waiting* → Wi-Fi on → *Online*; the order appears once in History
- [ ] Customer: QR order → staff mark served → customer taps **Pay by UPI at my table** → admin screen shows the red alarm with sound → Acknowledge → card says "take the QR to the table" → **Take payment** → UPI → customer sees *Payment Received*
- [ ] Orders → **Cancel** a paid order (reason) → cash refunded; if the kitchen had started, the bell shows a void alert
- [ ] Settings → Service charge 10% + Round off → new QR order shows "Service charge (optional)" and a round-off line → Take payment → *Customer asked to remove it* → total drops
- [ ] Cash & Shifts → **Pay out** ₹200 (category Consumables, "milk") → **To safe** ₹1,000 → Close shift: count less than expected → asks for a reason → closes; bell shows "closed short by ₹…"
- [ ] **Finance** → Today: sales, money in/out, shifts, voids; Money ledger lists every entry
- [ ] Finance → Expenses → Add expense (Electricity, *To pay later*) → Payables shows it → pay from Bank → disappears
- [ ] Finance → Expenses → Monthly bills → add "Shop rent" day 1 → it appears under Payables on its day
- [ ] Inventory → Purchases: a bill with *Paid in full* unticked → Finance → Payables shows it under the right age bucket
- [ ] Cashier login → lands on Counter; no Finance in the sidebar

**Known limits in this release**

- Offline needs the device to have opened the Counter online once (to store the menu). Offline bills show "≈" totals; the exact bill is priced when it syncs (cash is recorded as the exact bill amount).
- Bluetooth printers on Android come with the app (Phase 5); USB/network printers on a computer work now.
- Khata (credit) payments arrive with the kiosk (Phase 3).
- Money that moved before this release isn't in the ledger; account balances start from zero.

---

## Phase 1 — Inventory and recipes (2026-10-03)

**What's new**

| Area | Change |
| --- | --- |
| Stock ledger | Every stock change is one entry in Inventory → **Movements** (purchase, sale, cancelled order, transfer, wastage, staff meal, complimentary, correction, count). Entries can't be edited or deleted; mistakes are fixed with a correcting entry. |
| Locations | Main store, Kitchen and Kiosk are created for every cafe (add more under **Locations**). Purchases arrive at the purchase location; sales take stock from the sales location, or from the location set on the item's category or recipe (e.g. the Kiosk category sells from the Kiosk). |
| Stock items | Ingredients, resale products and packaging with a base unit (g, ml, pc) and pack units (Litre = 1000 ml, Crate = 24 pc), reorder level, usual vendor, how often to count, shelf order. |
| Vendors | Phone/WhatsApp, GSTIN, lead time, order cycle, payment terms, amount still to pay. |
| Purchases | Enter a supplier bill in pack units with GST, paid now or later, bill photo. Stock goes up and each item's **average cost** updates: (old stock × old cost + bill amount) ÷ (old + new quantity). A **price alert** shows when an item costs 10%+ more than its average. Unpaid bills can be paid later; a wrong entry can be undone. |
| Recipes & Costing | New page: ingredients × quantity (+ waste %) per menu item, live cost per portion, **food cost %** and **margin** (owner/manager only). Resale items (Coke, cigarettes) get a 1-piece recipe with one click. |
| Automatic deduction | Every order deducts its recipes from the right location the moment it's placed; cancelling the order puts the stock back. Each order line stores its cost at the time of sale (for profit reports later). |
| Wastage & meals | Record wastage (with reason and photo), staff meals and complimentary items per item and location. |
| Transfers | Move stock between locations, several items at once. |
| Counts & leaks | Start a count per location (daily items, daily + weekly, or everything). Blind count by default; expected is taken when each line is saved, so sales during the count don't show as loss. Posting corrects stock and records the variance in ₹. **Where stock went missing** lists count shortfall + wastage per item. |
| Reorder | Daily use (last 14 days), days left, reorder flag (at reorder level, or days left ≤ vendor lead time + 1) and suggested order in packs. **Reorder list** groups by vendor with a **Send on WhatsApp** button. |
| Dashboard | "Low stock" card replaced by **Stock alerts**: items to reorder and top leaks this week. |
| Search | Global search also finds stock items and vendors. |
| Permissions | Costs and stock value need "See cost prices"; margins and food cost % need "See profit". Wastage/counts need Inventory: Create; posting counts, transfers and corrections need Inventory: Edit; undoing purchases needs Inventory: Delete. The database enforces this. |
| Superadmin fix | **Owner PIN** now works for a cafe that had no PIN login (like the migrated `default` cafe): it creates the owner's PIN login from the owner name and mobile in **Edit cafe**. |
| Phone layout | Admin pages no longer scroll sideways on phones; wide tables scroll inside their box. |

**Deploy**

1. Supabase → SQL Editor → New query → paste **`supabase/upgrades/2026-10-phase1.sql`** → Run. Expected: *Success*. (Phase 0 must already be applied.)
2. Vercel redeploys from `main` automatically (~1 minute). Until step 1 runs, the Inventory page shows errors; everything else works.

**Test checklist** (owner login unless noted)

- [ ] Superadmin: Edit cafe → owner mobile filled → **Owner PIN** → set 4 digits → owner can log in with *Phone + PIN*
- [ ] Inventory → **Locations**: Main store (purchases), Kitchen (sales), Kiosk
- [ ] **Vendors** → Add vendor (e.g. Amul, phone, lead time 1, orders every 2 days)
- [ ] **Stock** → Add item *Milk*, unit `ml`, pack unit *Litre = 1000*, vendor Amul, count Daily
- [ ] Add item *Coffee beans*, unit `g`, cost ₹/kg, opening stock 1000
- [ ] **Purchases** → New purchase: Amul, Milk 5 Litre × ₹60 → stock shows 5 L at Main store, avg ₹60/L
- [ ] Second purchase at ₹75 → **price alert** appears; avg becomes ₹67.5/L
- [ ] Purchase with *Paid in full* unticked → shows under "To pay vendors" → **Record payment** clears it
- [ ] Stock → **Transfer** 3 Litre milk Main store → Kitchen → row shows "Main store 7 L · Kitchen 3 L"
- [ ] **Recipes & Costing** → a coffee → add Milk 150 ml + beans 10 g (5% waste) → cost, food cost %, margin show → Save
- [ ] Customer orders 2 of that coffee → Kitchen milk drops by 300 ml; beans by 21 g
- [ ] Cancel that order (Orders) → the stock comes back (Movements shows *Order cancelled*)
- [ ] Stock → **Wastage** on milk 100 ml (reason, optional photo) → Kitchen drops 100 ml
- [ ] **Where it went** (pie icon) on milk → shows the coffee and Wastage with %
- [ ] Kiosk item: Categories → Kiosk category → *Sales take stock from* = Kiosk; Recipes → a resale item → **Track it as its own stock item**; Purchases → buy 24 pc of it, *Received at* Kiosk; sell one → Kiosk stock drops by 1
- [ ] **Counts & leaks** → Start count → Kitchen, Daily items → type a lower milk quantity → **Post count** → variance in ₹ shows; *Where stock went missing* lists milk
- [ ] Stock → set milk reorder level above its stock → **Reorder** status + Reorder list with suggested Litres and **Send on WhatsApp**
- [ ] Dashboard → **Stock alerts** card shows the reorder item and the leak
- [ ] Search bar → vendor name and a stock item open the right tab
- [ ] Chef (Staff & Roles → Chef role: tick Inventory *Create*) → sees stock without costs, can record wastage and count, can't post a count
- [ ] Cashier → no Inventory or Recipes in the sidebar
- [ ] Phone: admin pages don't scroll sideways

**Known limits in this release**

- Variants and add-ons (Small/Large, extra shot) don't have their own recipes yet; give each size its own menu item for now.
- Counting works online only; the offline counter arrives with Phase 2.
- Selling a whole pack (e.g. a pack of 10 cigarettes as one line) comes with the kiosk (Phase 3); until then sell the pack as its own menu item with a 10-piece recipe.
- Vendor payments are tracked on the bill; they move into the money ledger and payables in Phase 2.
- Packaging bought in bulk: set *Track quantity* off; its cost per order is estimated in Phase 4 unit economics.

---

## Phase 0 — Foundation (2026-10-04)

**What's new**

| Area | Change |
| --- | --- |
| Platform | All cafes share one database; each cafe is a *tenant* with its own slug. Existing data moved into the cafe `default`. |
| Superadmin | `/superadmin` console (N.A.I.R. Solutions only): create cafes with an owner PIN, plans with staff limits, record payments (extends "paid until"), lock/unlock, reset owner PIN. |
| Billing lock | After "paid until" + grace days (default 3) a cafe locks: staff see "Account locked", customers can't order. Recording a payment unlocks instantly. Data is never deleted. |
| Staff logins | Staff log in at `/admin/login` with mobile + 4–6 digit PIN. 5 wrong PINs lock for 15 minutes. Owner email login still works. |
| Roles & permissions | Admin → Staff & Roles: 7 editable default roles (Owner, Manager, Cashier, Kiosk operator, Chef, Waiter, Accountant), a permission grid (view/create/edit/delete per section + sensitive switches), per-person exceptions. Enforced by the database, not just hidden. |
| Plan limits | Adding staff beyond the plan's limit is blocked ("Your plan allows 5 staff users…"). |
| Terms & consent | Owners and staff accept terms on first login; acceptances are stored and printable (Staff → Consent). |
| Audit log | Admin → Audit Log: who changed prices, menu, settings, orders, staff, roles and permissions, with before → after. Nobody can edit it. |
| Catalogue | Sub-categories, brands, item types (dish / resale / combo), selling unit, SKU, MRP, "price includes tax", per-item tax groups (Admin → Brands & Taxes), pack units (1 Pack = 10 pcs), restricted items. |
| Bills | Each item is taxed by its own tax group; MRP items include tax; restricted items get no coupons and earn no points; the cart shows the exact bill (each tax line) before ordering. FSSAI number in Settings, printed on bills. |
| Loyalty | Points are now earned on what the customer pays for eligible items **before tax** (previously on the total including tax). |
| Search | One search bar in admin (Ctrl+K or /): menu items (forgives typos), orders, customers (last digits of phone), categories, brands, staff, pages — only what the role may see. Phones are masked for roles without "see customer phone numbers". |

**Deploy (live: cafe-erp-dev / cafe-erp-rust.vercel.app)**

1. Supabase → SQL Editor → New query → paste **`supabase/upgrades/2026-10-phase0.sql`** → Run. Expected: *Success*.
2. Make yourself superadmin: Authentication → Users → **Add user** (your email + password, Auto Confirm), then SQL Editor:
   `select public.make_superadmin('your@email.com');`
3. The code is already on `main`; Vercel redeploys automatically (about 1 minute).
4. Optional: in Vercel set `VITE_TENANT_SLUG=default` (it's the default anyway).

Order doesn't matter: the new site works on the old database (owner keeps full access) and the old site works on the new database.

**Test checklist**

- [ ] Customer: open the site on your phone, log in with name + mobile, order 2 items, the cart shows CGST/SGST lines, order goes through
- [ ] Owner: `/admin/login` → **Owner email** tab → log in → accept the owner terms once → Dashboard loads
- [ ] Owner: Staff & Roles → **Add staff** (role Cashier, note the PIN) → appears with "1 of N staff users"
- [ ] Cashier: on another device or Incognito, `/admin/login` → mobile + PIN → accept staff terms → lands on **Orders**; sidebar has no Dashboard, Analytics, Staff or Audit
- [ ] Cashier: typing `/admin/analytics` in the address bar sends them back to Orders
- [ ] Owner: Roles & permissions → Cashier → tick **Dashboard & reports: View** → cashier reloads → Dashboard appears
- [ ] Owner: 5 wrong PINs on the cashier's login → "Too many wrong PINs"; owner resets the PIN (key icon) → new PIN works
- [ ] Owner: Brands & Taxes → add a brand and a tax group (e.g. Packaged goods 18% = CGST 9 + SGST 9)
- [ ] Owner: Categories → add a sub-category under an existing category
- [ ] Owner: Menu → edit an item → set brand, tax group, MRP, "price includes tax", restricted → card shows *Restricted* and *MRP*
- [ ] Owner: Menu → edit → **Pack units** → add "Pack = 10"
- [ ] Customer: order the restricted MRP item with a coupon → coupon applies only to the other items; total = MRP × qty for that item
- [ ] Owner: Settings → FSSAI number → Save → generate a bill → FSSAI shows on it
- [ ] Owner: search bar → type a dish with a typo, a customer's last 4 digits, an order number → each opens the right page
- [ ] Owner: Audit Log → shows the price / staff / permission changes you just made with your name
- [ ] Owner: Staff → Consent "v1" → Print / Save as PDF works
- [ ] Superadmin: `/superadmin` → log in → see the `default` cafe → **Record payment** (1 month) → paid-until moves 1 month
- [ ] Superadmin: **Lock now** → owner/cashier see "Account locked"; customer gets "Ordering is paused" → **Unlock** → all normal
- [ ] Superadmin: **New cafe** (test) → appears with its owner; (its site needs a separate Vercel project with `VITE_TENANT_SLUG=<slug>`)

**Known limits in this release**

- A customer page doesn't show a "paused" banner before ordering when the cafe is locked; the message appears when placing the order.
- Kiosk/device limits in plans are stored but not enforced until the kiosk ships (Phase 3).
- Pack units are recorded now and will drive stock deduction in Phase 1 (inventory).
