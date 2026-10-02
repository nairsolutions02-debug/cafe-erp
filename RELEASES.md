# Cafe ERP — Release log

Newest first. Each release lists what changed, how to deploy it, and a checklist to test on the live site.

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
