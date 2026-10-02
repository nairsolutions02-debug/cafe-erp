# Cafe ERP - Setting Up a New Cafe

> **On your phone, use [`docs/cafe-setup-guide.html`](docs/cafe-setup-guide.html) instead.**
> It's the same guide as one offline file with a form: type the cafe's details once and every
> link, the Vercel env block and all SQL (database setup, admin, menu, tables) are generated with
> Copy buttons, plus tick-off checklists. This Markdown file is the reference copy.

Each cafe gets its **own Supabase project** (database, logins, images, live updates) and its
**own Vercel project** (the website), both from this one repo. There's no backend server and no Railway.

**Time per cafe:** ~30 minutes, most of it typing the menu.

| # | Step | Time |
|---|---|---|
| 1 | [One-time setup](#1-one-time-setup-only-once-ever) | once ever |
| 2 | [Collect from the owner](#2-collect-from-the-cafe-owner) | 10 min |
| 3 | [Create Supabase project](#3-create-the-supabase-project) | 3 min + 2 min wait |
| 4 | [Load the database](#4-load-the-database) | 2 min |
| 5 | [Login settings](#5-login-settings) | 1 min |
| 6 | [Owner's admin account](#6-owners-admin-account) | 2 min |
| 7 | [Bill details, menu & tables](#7-bill-details-menu--tables) | 5–10 min |
| 8 | [Upload logo](#8-upload-the-logo-optional) | 2 min (optional) |
| 9 | [Deploy the website](#9-deploy-the-website-vercel) | 4 min + 1 min build |
| 10 | [Connect site URL](#10-connect-the-site-url) | 1 min |
| 11 | [Test everything](#11-test-everything) | 5 min |
| 12 | [Print table QR codes](#12-print-table-qr-codes) | 3 min |
| 13 | [Hand over to the owner](#13-hand-over-to-the-owner) | 5 min |
| — | [Custom domain](#custom-domain-optional) · [Troubleshooting](#troubleshooting) · [Updates & maintenance](#updates--maintenance) · [OTP](#turning-on-sms-otp-later) · [Costs](#costs--plans) | |

In the links below, replace `<ref>` with the cafe's Supabase project ref (the part before
`.supabase.co` in the Project URL).

---

## 1. One-time setup (only once ever)

- [ ] **GitHub repo** `nairsolutions02-debug/cafe-erp` has the latest code on `main`.
- [ ] **Vercel can see the repo.** The *Vercel GitHub App* must be installed on `nairsolutions02-debug`
      with access to `cafe-erp`. Signing in to Vercel with GitHub is **not** the same thing.
      → https://github.com/settings/installations → Vercel → Configure → Repository access.
- [ ] **Supabase account** → https://supabase.com/dashboard/projects
- [ ] **Vercel Pro** before the first paying cafe (Hobby = non-commercial only). One Pro team holds all cafes.
- [ ] **2-factor login** on GitHub, Vercel and Supabase.
- [ ] **Password manager** for each cafe's Supabase DB password and owner login.

## 2. Collect from the cafe owner

- [ ] Cafe **name** (exactly as on the board) and a one-line **tagline**
- [ ] **Owner's email**: becomes the admin login; must be one they can open
- [ ] **Logo**: square PNG/JPG, ideally 512×512
- [ ] **Brand colour** hex, e.g. `#2E7D32`
- [ ] **Address**, **phone**, **opening hours**, Instagram link
- [ ] **GSTIN** (if registered) and GST rate. Most cafes 5% (2.5% CGST + 2.5% SGST); unregistered 0%
- [ ] **Full menu with prices** (photo of the menu card is enough), veg / non-veg
- [ ] **Number of tables** and their numbering (1, 2, 3… or A1, A2…)
- [ ] Optional: photos of 5–10 bestsellers

## 3. Create the Supabase project

1. https://supabase.com/dashboard/new → choose your organization.
2. **Project name**: cafe name in lowercase with dashes, e.g. `chai-point`.
3. **Database password**: *Generate a password* → save it in your password manager
   ("Chai Point Supabase DB"). You can't view it again.
4. **Region**: **South Asia (Mumbai)**.
5. **Create new project** and wait ~2 minutes until it's ready.
6. Note the **Project URL** (`https://<ref>.supabase.co`) and the **Publishable key** (`sb_publishable_…`)
   from `https://supabase.com/dashboard/project/<ref>/settings/api-keys`.

> **Never** copy the secret key (`sb_secret_…`) into Vercel, chats or the guide.

## 4. Load the database

1. Open `https://supabase.com/dashboard/project/<ref>/sql/new`.
2. Paste the **whole setup SQL** and tap **Run**. Get it from the phone guide (*Copy setup SQL*), or
   concatenate every file in `supabase/migrations/` in order.
3. Expected: **"Success. No rows returned"** (a `pgcrypto already exists` notice is fine).
4. Check `…/editor` lists `orders`, `menu_items`, `dining_tables`, etc.

Run it **once per project**. A second run gives "already exists" errors, which are harmless.

## 5. Login settings

`https://supabase.com/dashboard/project/<ref>/auth/providers`

- [ ] **Allow anonymous sign-ins: ON**. This is how customers log in with name + mobile.
- [ ] **Allow new users to sign up: leave ON.**
- [ ] **Email provider: leave enabled.**

> ⚠️ Turning off sign-ups **blocks customer login** ("Signups not allowed for this instance"), and
> turning off Email **blocks admin login** ("Email logins are disabled"). Both were tested.
> Leaving them on is safe: a stranger who signs up gets no admin access. Admin rights only come from
> `make_admin` (next step).

## 6. Owner's admin account

1. `https://supabase.com/dashboard/project/<ref>/auth/users` → **Add user → Create new user**.
2. Owner's email + a strong password (12+ chars) → tick **Auto Confirm User** → Create.
3. SQL Editor → run (with the exact email):

```sql
select public.make_admin('owner@email.com', 'default');
```

Expected: one row `ok`. "No user with email…" means the email doesn't match.
The second value is the **cafe code** (tenant slug). A cafe with its own Supabase project always uses
`default`.

4. **Your platform login** (once per Supabase project): add a user with *your* email the same way, then
   `select public.make_superadmin('your@email.com');`. Open `https://<site>/superadmin` to pick the plan
   (staff limit), record monthly payments ("paid until") and lock/unlock. The cafe locks itself
   `grace_days` (3) after "paid until" with no payment, so **record the first payment right after setup**.
5. **Staff** don't need Supabase users: the owner adds them in Admin → **Staff & Roles** (mobile + 4–6
   digit PIN, role). They log in at `/admin/login` → *Phone + PIN*. 5 wrong PINs lock for 15 minutes.
6. Several cafes can also share **one** Supabase project: create them in `/superadmin` → **New cafe**
   (owner gets a PIN login), then give each its own Vercel project with `VITE_TENANT_SLUG=<cafe code>`.

## 7. Bill details, menu & tables

One SQL paste instead of tapping through admin screens; everything stays editable in the admin panel.
The phone guide **generates this SQL from a typed menu** (`Category | Item | Price | veg/nonveg | description`,
one item per line). To write it by hand:

```sql
-- Every row belongs to a cafe (tenant). Own Supabase project = cafe code 'default'.

-- Bill details (printed on every bill)
insert into public.settings (tenant_id, key, value)
select t.id, v.key, v.value from (select id from public.tenants where slug = 'default') t, (values
    ('restaurant_name', '"Chai Point"'::jsonb),
    ('restaurant_address', '"Shop 4, Nehru Nagar, Bhilai"'::jsonb),
    ('restaurant_phone', '"+91 98xxxxxxxx"'::jsonb),
    ('gst_number', '"22ABCDE1234F1Z5"'::jsonb),
    ('fssai_number', '"12345678901234"'::jsonb),
    ('gst_rate', '5'::jsonb),
    ('tax_config', '[{"name":"CGST","rate":2.5},{"name":"SGST","rate":2.5}]'::jsonb)
) as v(key, value)
on conflict (tenant_id, key) do update set value = excluded.value;

-- Categories (in display order)
insert into public.categories (tenant_id, name, sort_order)
select (select id from public.tenants where slug = 'default'), v.name, v.sort_order from (values
    ('Hot Beverages', 1), ('Snacks', 2), ('Cold Beverages', 3)
) as v(name, sort_order)
on conflict (tenant_id, name) do nothing;

-- Menu items
insert into public.menu_items (tenant_id, name, description, price, is_veg, is_upsell, category_id)
select c.tenant_id, v.name, v.description, v.price, v.is_veg, v.is_upsell, c.id from (values
    ('Masala Chai', 'Ginger & cardamom', 30, true, false, 'Hot Beverages'),
    ('Chicken Puff', '', 50, false, false, 'Snacks'),
    ('Water Bottle', '', 20, true, true, 'Cold Beverages')
) as v(name, description, price, is_veg, is_upsell, category)
join public.categories c on c.name = v.category
 and c.tenant_id = (select id from public.tenants where slug = 'default')
where not exists (select 1 from public.menu_items m where m.tenant_id = c.tenant_id and lower(m.name) = lower(v.name));

-- Tables 1..8
insert into public.dining_tables (tenant_id, table_number)
select (select id from public.tenants where slug = 'default'), n::text from generate_series(1, 8) n
on conflict (tenant_id, table_number) do nothing;
```

- Not GST-registered: `gst_rate` `0` and `tax_config` `[]`.
- Name one item exactly **Water Bottle**: the cart suggests it to every customer.
- Safe to re-run: existing categories, items and tables are skipped.
- Sales demo instead of a real menu: run `supabase/sample-data.sql`.

## 8. Upload the logo (optional)

1. `https://supabase.com/dashboard/project/<ref>/storage/buckets/images` → **Upload file**.
2. Tap the file → **Get URL** → copy. That's `VITE_CAFE_LOGO_URL` for step 9.
3. Optional: upload a wide food photo the same way for `VITE_CAFE_HERO_IMAGE_URL` (the home page
   banner; default is a dosa photo).

Skip it and a neutral cup logo is used.

## 9. Deploy the website (Vercel)

1. https://vercel.com/new → GitHub dropdown **nairsolutions02-debug** → **cafe-erp** → **Import**.
   Not listed? Dropdown → *Add GitHub Scope*, or fix app access (step 1).
2. **Vercel Team**: the Pro team for paying cafes. **Project Name**: e.g. `chai-point` →
   site becomes `https://chai-point.vercel.app` if free.
3. **Root Directory → Edit → `frontend`**. Framework: Vite (auto).
   ⚠️ The #1 mistake: without Root Directory = `frontend` the build fails.
4. **Environment Variables**: paste this block (edited) into the first **Key** box. Vercel splits it:

```env
VITE_SUPABASE_URL="https://<ref>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
VITE_TENANT_SLUG="default"
VITE_CAFE_NAME="Chai Point"
VITE_CAFE_TAGLINE="Bhilai's favourite chai"
VITE_CAFE_THEME_COLOR="#2E7D32"
VITE_CAFE_LOGO_URL="https://<ref>.supabase.co/storage/v1/object/public/images/logo.png"
VITE_CAFE_ADDRESS="Shop 4, Nehru Nagar, Bhilai"
VITE_CAFE_PHONE="+91 98xxxxxxxx"
VITE_CAFE_HOURS_TIME="8:00 AM - 11:00 PM"
VITE_CAFE_INSTAGRAM="https://instagram.com/..."
```

   Only the first two are required (`VITE_TENANT_SLUG` defaults to `default`). Keep the quotes (a bare `#` starts a comment).
   All options: `frontend/.env.example` (hero text/image, stats, search hints, hours days, email, Facebook).
5. **Don't** click "Add" next to Supabase under *Optional Integrations* (it would create a second database).
6. **Deploy** → copy the domain when it says *Congratulations*.

Changing env vars later: Project → Settings → Environment Variables → save → **Deployments → ⋯ → Redeploy**.

## 10. Connect the site URL

`https://supabase.com/dashboard/project/<ref>/auth/url-configuration` → **Site URL** = the Vercel URL → Save.

## 11. Test everything

Use two devices (owner's laptop/tablet = admin, your phone = customer) or a normal + Incognito window.
**One browser can't be admin and customer at once.** A browser logged in as admin shows
"Signed in as admin" on customer pages.

- [ ] `https://<site>/admin/login` → **Owner email** tab → owner's email + password → accept terms once
- [ ] Admin → **Staff & Roles**: add a Cashier with a PIN; in Incognito log in with *Phone + PIN* → lands
      on Orders, no Dashboard/Analytics in the sidebar
- [ ] `https://<site>/superadmin` (your login) → record the first payment
- [ ] Admin → **Settings**: name, address, GSTIN, taxes correct → Save
- [ ] Admin → **Menu**: items present; add a photo to one item (tests uploads)
- [ ] Leave **Admin → Orders** open
- [ ] Phone: `https://<site>/?table=1` → name + mobile → straight in (no OTP)
- [ ] Add 2 items → cart shows **"Table 1 - Your table"** → Place Order
- [ ] Order appears on admin **within 1–2 s without refresh**, with a sound
- [ ] Admin: Confirm → Start Preparing → Mark Ready → Mark Served (phone updates each time)
- [ ] Phone: **Request Bill** → Admin: **Generate Bill** (check name/GSTIN/tax lines) → **Cash Paid**
      → phone shows "Payment Received"
- [ ] Admin → Dashboard shows today's revenue

## 12. Print table QR codes

1. Admin → **Tables**: all tables listed (add more with *Add Multiple*).
2. **QR Codes → Print**. On a phone choose *Save as PDF* and send it to a print shop
   (laminated A6/A7 cards or table stands).
3. Scan one printed QR before sticking them: it must open the menu with that table selected.
4. Optional: a general QR (no table) for the counter/door: `https://<site>`.

QR codes contain only the site address + table number; reprint if the domain changes.

## 13. Hand over to the owner

- [ ] WhatsApp the owner the menu link, admin link and login email; send the password separately.
- [ ] Show staff the flow: **Confirm → Preparing → Ready → Served → Generate Bill → Cash/Online Paid**.
      Keep the Orders page open on the counter device, volume up.
- [ ] Show the owner: marking an item out of stock, changing prices, adding a coupon.
- [ ] Save your own record: cafe name, site URL, Supabase project link, Vercel project name,
      owner email, number of tables, setup date.

---

## Custom domain (optional)

1. Vercel → project → **Settings → Domains** → add e.g. `order.chaipoint.in`.
2. At the domain provider add the DNS record Vercel shows (usually CNAME → `cname.vercel-dns.com`).
3. Once "Valid Configuration": update Supabase **Site URL** (step 10) and reprint QR codes.

## Troubleshooting

| What you see | Fix |
|---|---|
| Vercel build fails / "No package.json" | Settings → General → **Root Directory** = `frontend` → Redeploy |
| `cafe-erp` missing in Vercel import list | GitHub → Settings → Installed apps → Vercel → Configure → add `cafe-erp` |
| Site opens but menu empty / console errors | Wrong `VITE_SUPABASE_URL` or key → fix env vars → **Redeploy** |
| "Anonymous sign-ins are disabled" | Step 5: turn on anonymous sign-ins |
| "Signups not allowed for this instance" | Step 5: turn **Allow new users to sign up** back ON |
| Admin: "Invalid credentials" | Check email/password; reset via Auth → Users → ⋯, or recreate user + `make_admin` |
| Admin: "Email logins are disabled" | Auth → Sign In / Providers → Email → enable |
| Admin: "This account is not an admin" | Run `select public.make_admin('exact@email');` |
| Customer page shows "Signed in as admin" | That browser is logged in as admin: other device/Incognito, or tap "Log out admin" |
| "Please sign in first" when ordering | Refresh, log in again with name + mobile |
| "This table is currently occupied" | Another customer has an open bill there; Admin → Tables → **Free Table** if stale |
| Orders only appear after refresh | Setup SQL incomplete: check Database → Publications → `supabase_realtime` has `orders` and `dining_tables` |
| Image upload fails | Must be admin; < 5 MB; jpg/png/webp/gif |
| Wrong tax on bills | Admin → Settings → Tax Configuration (new orders only) |
| Supabase project "Paused" | Free projects pause after 7 idle days → open project → **Restore**; busy cafes → Pro |
| Setup SQL: "already exists" | Already ran on this project; nothing to do |

Still stuck: screenshot the screen + browser console (F12 → Console) and send it to Claude.

## Updates & maintenance

- **Website changes**: merge to `main` → every cafe's Vercel project rebuilds (~1 min).
- **Release notes**: every push to `main` is listed in `RELEASES.md` with what changed, deploy steps and
  a test checklist. Tick through that checklist on the live site after each release.
- **Database changes**: when a release ships an upgrade file in `supabase/upgrades/` (e.g.
  `2026-10-phase0.sql`), paste **that one file** into each cafe's SQL Editor → Run. It runs in one
  transaction (all or nothing). Otherwise run only the new `supabase/migrations/` file, or from the repo
  on your Mac (needs the DB password):
  ```bash
  git pull
  npx supabase link --project-ref <ref>
  npx supabase db push
  ```
  Then rebuild the phone guide so its setup SQL includes the new file:
  `node scripts/build-setup-guide.mjs`.
- **Monthly per cafe**: check Supabase usage (free: 500 MB database, 1 GB files); export orders as a
  backup on the free plan (Pro has daily backups); optionally clean old anonymous logins:
  ```sql
  delete from auth.users
   where is_anonymous
     and created_at < now() - interval '90 days'
     and id not in (select id from public.profiles where customer_id is not null);
  ```

## Turning on SMS OTP later

Today customers log in with name + mobile only. The trade-off is that anyone typing someone else's number sees that
person's history and points. To require OTP for a cafe:

1. Get a 2factor.in API key.
2. From the repo:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase secrets set TWOFACTOR_API_KEY=<key>
   npx supabase functions deploy phone-otp
   ```
3. SQL: `update public.settings set value = 'true' where key = 'otp_login_enabled';`
4. Vercel: add `VITE_OTP_LOGIN` = `true` → Redeploy.

## Costs & plans

| Item | Free | Paid |
|---|---|---|
| Vercel (websites) | Hobby: non-commercial only | Pro ≈ $20/month per member, holds all cafes |
| Supabase (database) | 2 free projects per account; pauses after 7 idle days; no automatic backups | Pro ≈ $25/month per organization (one project's compute included); each extra project ≈ $10/month |
| Domain (optional) | — | ≈ ₹800–1,200/year (.in) |
| SMS OTP (if enabled) | — | Prepaid per SMS |

Prices change; check the providers' pricing pages before quoting a cafe.

## Local development

```bash
npx supabase start            # local Supabase in Docker
npx supabase db reset         # apply migrations
cd frontend && cp .env.example .env.local   # local URL + publishable key from `supabase start`
npm install && npm run dev
npm run test:db               # end-to-end database checks
```
