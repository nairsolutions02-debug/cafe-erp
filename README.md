# Cafe ERP - White-label Cafe & Restaurant Management System

A white-label cafe/restaurant system (originally built for Chetta's Dosa): QR table ordering,
live order tracking, billing, loyalty points, inventory, staff attendance and analytics.
Each cafe runs on its own **Vercel** site and **Supabase** project. There is no separate server.

## 🌟 Features

### Customer
- **Scan & order**: each table has a QR code; the menu opens with the table already selected
- **No-OTP login**: name + mobile number on first visit (SMS OTP is built in but switched off)
- **Menu**: categories, search, bestsellers and homepage collections
- **Cart**: coupons, loyalty rewards, recommendations, cart upsell item
- **Live order tracking**: status updates appear instantly
- **Bill**: request the bill, see GST breakdown, payment confirmation
- **History & profile**: past orders and loyalty points

### Admin (`/admin`)
- **Dashboard**: today's and month's revenue, pending orders, top spenders, low stock
- **Orders board**: live new-order alerts with sound; confirm → prepare → ready → served → bill → paid;
  orders from one table within the same session are billed together
- **Menu, categories, homepage sections** with photo upload (auto-resized)
- **Tables** with printable QR codes
- **Coupons**, **loyalty program** (points per ₹, rewards, bonus points per item)
- **Inventory**: stock by location (store, kitchen, kiosk), vendors, purchases with weighted average cost and
  price alerts, wastage, transfers, counts with variance in ₹, reorder alerts with WhatsApp orders
- **Recipes & costing**: every sale deducts its recipe; cost, food cost % and margin per dish
- **Counter (POS)** with offline mode, **kitchen screen**, 80 mm KOT/bill printing, split payments, manager-PIN discounts and voids
- **Cash & shifts** with note counts, **money ledger**, expenses (recurring, spread), payables with aging, day summary
- **Alerts**: bell + full-screen alarm (snooze, escalation), per-person alert grid with quiet hours, phone push, installable app
- **Staff app**: check-in/out with selfie inside the cafe's geofence, breaks, leave, on-premises alerts; Android APK with lock-screen alarms
- **Quick kiosk** (tabs, packs, one-tap Cash/UPI/Khata) and **khata** with limits, aging, collection and WhatsApp reminders
- **Reports**: P&L with "Why?", cash flow, profit targets, item profit, GST pack + due dates; **payroll** with leave, OT, advances, penalties, payslips
- **Employees**, attendance and holidays
- **Rewards**: rule builder (when / if / give / limits / tell) with budgets, WhatsApp to-do, customer portal with editable slogans, Instagram verification, dish ratings, Google review link, automatic customer groups
- **Incentives** for staff (per item, add-on, target, team pool, ratings) on payslips
- **Profit advisor**: ~18 checks with ₹ impact and the working (Why?), one-tap price change, results after 4 weeks; **menu matrix**; Swiggy/Zomato/Petpooja CSV import
- **Customers** and **analytics** (revenue, categories, top items, growth)
- **Settings**: restaurant details, FSSAI and taxes printed on bills
- **Staff & Roles**: staff log in with mobile + PIN; editable roles and a permission grid enforced by the
  database; per-person exceptions; consent records
- **Catalogue**: sub-categories, brands, tax groups, MRP items, pack units, restricted items
- **Audit log** and **global search** (Ctrl+K)

### Platform (`/superadmin`)
- Cafes (tenants), plans with staff limits, payments, automatic lock after the grace period

Release notes and per-release test checklists: [`RELEASES.md`](RELEASES.md).

## 🛠️ Tech Stack

- **Frontend**: React + Vite, vanilla CSS, Recharts (hosted on Vercel)
- **Backend**: Supabase: Postgres, Auth (anonymous + email), Storage, Realtime
- **Business logic**: Postgres functions in `supabase/migrations/` (prices, taxes, coupons and points
  are always calculated in the database, never trusted from the browser)
- **Security**: row level security; customers only see their own orders, back office is admin-only

## 📁 Project Structure

```
├── frontend/
│   ├── src/
│   │   ├── admin/        # Admin pages
│   │   ├── components/   # Shared components (QuickLoginForm, OrderBill, ...)
│   │   ├── context/      # Auth & cart
│   │   ├── lib/          # Supabase client, live updates, QR table helper
│   │   ├── pages/        # Customer pages
│   │   ├── utils/api.js  # All data access (Supabase)
│   │   └── brand.js      # Per-cafe branding from env vars
│   └── tests/            # npm run test:db
└── supabase/
    ├── migrations/       # Database schema, functions, security
    ├── functions/        # phone-otp (dormant)
    └── sample-data.sql   # Optional demo menu
```

## 🚀 Setting up a cafe

On your phone, open **[docs/cafe-setup-guide.html](docs/cafe-setup-guide.html)** (offline, fills in links and SQL for you). Reference copy: **[DEPLOYMENT.md](DEPLOYMENT.md)**: create a Supabase project, `supabase db push`, create the
owner's admin login, deploy `frontend/` to Vercel with the cafe's env vars, print the table QR codes.

## 🏷️ Branding

Everything cafe-specific is an env var on the cafe's Vercel project (see `frontend/.env.example`):
name, tagline, colour, logo, hero text/image, contact details, hours, search hints.
Bill details (name, address, GSTIN, taxes) are set in Admin → Settings.

## 💻 Local development

```bash
npx supabase start && npx supabase db reset
cd frontend
cp .env.example .env.local    # fill in the local URL + publishable key from `supabase start`
npm install && npm run dev    # http://localhost:5173
npm run test:db               # end-to-end database checks (needs the local stack)
```

Create a local admin: add a user in Supabase Studio (http://127.0.0.1:54323) and run
`select public.make_admin('you@example.com', 'default');` in the SQL editor.

## 📝 License

MIT License

---

**Cafe ERP by N.A.I.R. Solutions** 🍽️
