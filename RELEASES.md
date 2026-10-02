# Cafe ERP — Release log

Newest first. Each release lists what changed, how to deploy it, and a checklist to test on the live site.

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
