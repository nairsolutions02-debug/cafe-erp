# Cafe ERP - Deploying a New Cafe

Each cafe gets its **own** frontend, backend and database, all built from this one repo.
A fix pushed to `main` redeploys every cafe.

| Part | Where | One per cafe? |
|---|---|---|
| Frontend (`frontend/`) | Vercel project | Yes |
| Backend (`backend/`) | Railway / Render service | Yes |
| Database | MongoDB Atlas database | Yes |
| Images | Cloudflare R2 bucket (or a folder per cafe) | Yes |

> Planned: move the backend + database to Supabase, which removes the separate backend host.

## 1. Database
1. In MongoDB Atlas create a database named after the cafe, e.g. `chaipoint`.
2. Network Access: allow the backend host's IPs (or `0.0.0.0/0`).
3. Copy the connection string into `MONGODB_URI`.

## 2. Backend
1. New service from this repo, **root directory `backend`**, start command `npm start`.
2. Set the env vars from `backend/.env.example`. Required:
   - `MONGODB_URI`, `JWT_SECRET` (`openssl rand -hex 32`), `ADMIN_PASSWORD`, `FRONTEND_URL`
   - `SMS_API_KEY` for real OTP SMS, `R2_*` for image uploads
3. Check `https://<backend>/api/health` returns `OK`.

## 3. Frontend (Vercel)
1. New project from this repo, **root directory `frontend`**, framework preset **Vite**.
2. Env vars:
   - `VITE_API_URL=https://<backend>` (no trailing `/api`)
   - `VITE_CAFE_NAME`, `VITE_CAFE_TAGLINE`, `VITE_CAFE_THEME_COLOR`, `VITE_CAFE_LOGO_URL`, contact and hours vars (see `frontend/.env.example`)
3. Deploy, then put the Vercel URL into the backend's `FRONTEND_URL`.

Logo: upload the cafe's logo (e.g. to R2) and set `VITE_CAFE_LOGO_URL` to its URL.

## 4. First login
1. Open `/admin/login`, log in with `ADMIN_PHONE` / `ADMIN_PASSWORD`.
2. Admin → Settings: restaurant name, address, phone, GSTIN, taxes.
3. Add categories, menu items and tables.

## Troubleshooting
- **Login fails / CORS errors**: `FRONTEND_URL` must exactly match the Vercel URL.
- **"Admin login is not configured"**: `ADMIN_PASSWORD` is not set on the backend.
- **Backend crashes on start**: usually `MONGODB_URI` wrong or Atlas IP not allowed.
- **No OTP SMS**: `SMS_API_KEY` missing; the OTP is printed in the backend logs instead.
