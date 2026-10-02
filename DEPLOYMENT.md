# Cafe ERP - Setting Up a New Cafe

Each cafe gets its **own Supabase project** (database, login, images, live updates)
and its **own Vercel project** (the website), both built from this one repo.
There is no separate backend server, so Railway is not needed.

A fix pushed to `main` redeploys every cafe's website. Database changes
(new files in `supabase/migrations/`) are applied to each cafe with `supabase db push`.

| Part | Where | One per cafe |
|---|---|---|
| Website (`frontend/`) | Vercel project | Yes |
| Database, login, images, live updates | Supabase project | Yes |

Time per cafe: about 30 minutes once you've done it once.

---

## 1. Create the Supabase project

1. supabase.com → **New project**. Name it after the cafe (e.g. `chaipoint`).
   Region: **Mumbai (ap-south-1)**. Save the database password somewhere safe.
2. **Authentication → Sign In / Providers**:
   - turn **on** "Allow anonymous sign-ins" (this is how customers log in with just name + mobile)
   - leave **Email** on (admins use it); turn **off** "Allow new users to sign up" so only you create admin accounts
     (anonymous sign-ins keep working)
3. **Authentication → URL Configuration**: set **Site URL** to the cafe's website URL (after step 3).

## 2. Load the database

From your Mac, in this repo:

```bash
npx supabase login                       # once
npx supabase link --project-ref <project-ref>   # ref is in the project URL
npx supabase db push                     # creates all tables, functions, security rules
```

Optional demo menu: open **SQL Editor**, paste `supabase/sample-data.sql`, run.

### Create the owner's admin login

1. **Authentication → Users → Add user → Create new user**: owner's email + a strong password,
   tick "Auto Confirm User".
2. **SQL Editor**, run:

```sql
select public.make_admin('owner@cafe.com');
```

## 3. Create the Vercel project

1. vercel.com → **Add New → Project** → import this repo.
2. **Root Directory: `frontend`**. Framework preset: **Vite** (auto-detected).
3. **Environment Variables** (see `frontend/.env.example` for the full list):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` key |
| `VITE_CAFE_NAME` | e.g. `Chai Point` |
| `VITE_CAFE_TAGLINE` | e.g. `Bhilai's favourite chai` |
| `VITE_CAFE_THEME_COLOR` | e.g. `#2E7D32` |
| `VITE_CAFE_LOGO_URL` | URL of the logo (upload it to Supabase Storage → `images` bucket → copy URL) |
| `VITE_CAFE_ADDRESS`, `VITE_CAFE_PHONE`, `VITE_CAFE_HOURS_TIME` | contact details for the footer |

Never put the `service_role` key in Vercel. The site only needs the `anon` key.

4. **Deploy**. Then put the Vercel URL into Supabase's Site URL (step 1.3).
5. Custom domain (optional): Vercel → Settings → Domains.

## 4. First login and setup

1. Open `https://<site>/admin/login`, sign in with the owner's email and password.
2. **Settings**: restaurant name, address, phone, GSTIN, taxes (these print on bills).
3. **Categories → Menu**: add items with photos (images are resized automatically).
4. **Tables → Add Multiple**, then **QR Codes → Print**. Stick one QR on each table.

## How customers use it

1. Scan the table QR → the menu opens with their table remembered.
2. First time: enter **name + mobile number** → straight in, no OTP.
   The same mobile number on another phone opens the same account (order history and points).
3. Order → follow status live → **Request Bill** → pay at the counter.

## Keeping cafes up to date

- **Website changes**: push to `main`. Every Vercel project rebuilds automatically.
- **Database changes**: for each cafe, `npx supabase link --project-ref <ref> && npx supabase db push`.

## Switching on OTP login later (dormant for now)

The SMS OTP code is kept but switched off. To turn it on for a cafe:

1. `npx supabase secrets set TWOFACTOR_API_KEY=<2factor.in key>`
2. `npx supabase functions deploy phone-otp`
3. SQL: `update public.settings set value = 'true' where key = 'otp_login_enabled';`
4. Vercel: set `VITE_OTP_LOGIN=true` and redeploy.

## Good to know

- **Free plan pauses** a Supabase project after 7 days with no activity. A cafe that is open daily
  won't hit this; for a cafe closing for a long holiday, open the site once a week or use the Pro plan.
- **Vercel's free (Hobby) plan is for non-commercial use.** Paid cafes should be on Vercel Pro
  (one Pro account can hold many cafe projects).
- **Backups**: Supabase Pro has daily backups. On the free plan, export from Database → Backups
  or run `npx supabase db dump` regularly.

## Troubleshooting

| Problem | Fix |
|---|---|
| Customer login says "Anonymous sign-ins are disabled" | Turn on anonymous sign-ins (step 1.2) |
| Admin login says "This account is not an admin" | Run `select public.make_admin('email')` |
| Site loads but menu is empty / errors | Check `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, then redeploy |
| Orders don't appear live on the admin screen | Run `npx supabase db push` (enables live updates on orders and tables) |
| Image upload fails | Must be logged in as admin; images up to 5 MB (jpg, png, webp, gif) |

## Local development

```bash
npx supabase start            # local Supabase in Docker
npx supabase db reset         # apply migrations
cd frontend && cp .env.example .env.local   # use the local URL + anon key printed by `supabase start`
npm install && npm run dev
npm run test:db               # end-to-end database checks
```
