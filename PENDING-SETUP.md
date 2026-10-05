# Pending setup

Owner: Pravin. Started 2026-10-03 (combined Phase 2–7 SQL already run on FiKA).
Tick each box (`[x]`) as you finish it and push, or tell Claude "done: <step>".

## 1. Phone alerts when the app is closed
- [x] 1.1 Generate push keys (Windows: PowerShell; Mac: Terminal): `npx web-push generate-vapid-keys` (keep the private key secret — never paste it in chat)
- [x] 1.2 Vercel → FiKA project → Settings → Environment Variables → `VITE_VAPID_PUBLIC_KEY` = public key → Redeploy
- [x] 1.3 Supabase → Edge Functions → Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:nairsolutions02@gmail.com`), `PUSH_WEBHOOK_SECRET` (Windows PowerShell: `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`; Mac: `openssl rand -hex 24`)
- [x] 1.4 Deploy: `git pull` → `npx supabase login` → `npx supabase functions deploy push-notify --project-ref <ref> --no-verify-jwt`
- [x] 1.5 Supabase → Database → Webhooks → `push` on `notification_events` INSERT → Edge Function `push-notify`, header `x-webhook-secret`
- [x] 1.6 Test: My day → Turn on alerts → close the browser → QR order from another phone → notification arrives

## 2. Android staff app (optional, but decide yes/no)
- [x] 2.1 Firebase project + Android app (package e.g. `in.nairsolutions.fika`) → `google-services.json` → GitHub secret `GOOGLE_SERVICES_JSON`
- [x] 2.2 Firebase service-account JSON → Supabase secret `FCM_SERVICE_ACCOUNT`
- [x] 2.3 (optional) Signing key → GitHub secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- [x] 2.4 GitHub → Actions → Android app → Run workflow → download APK → install on one staff phone → My day → Phone setup all green → Test alarm

## 3. Setup inside the app (FiKA)
- [x] 3.1 Attendance → stand in the cafe → Use my location → Save
- [x] 3.2 Attendance → link every employee to their staff login; set shift start
- [x] 3.3 Recipes & Costing → recipes for the top 10–15 dishes
- [x] 3.4 Reports → Profit target → monthly (and weekly) target
- [x] 3.5 Rewards → Customer portal → Google review link + cafe Instagram username → Save

Full click-by-click steps: `RELEASES.md` → Phase 5 (sections 1–2) and the Phase 5–7 checklists (section 3).

## 4. Kiosk menu (2026-10-03)
- [x] 4.1 Supabase → SQL Editor → paste `supabase/upgrades/2026-10-kiosk-menu.sql` → Run → Success
- [x] 4.2 Menu → switch off **Kiosk** on items the kiosk doesn't sell and **Main shop** on kiosk-only items (use the Where sold filter to check)

## 5. Table QR ordering (2026-10-04)
- [x] 5.1 Supabase → SQL Editor → paste `supabase/upgrades/2026-10-table-ordering.sql` → Run → Success
- [x] 5.2 Tables → QR Codes → Print → stick the new QR on every table
- [x] 5.3 Menu → Customer app → check table mode, sharing and "staff confirm first order"; add at least one banner
- [x] 5.4 When every table has the new QR: Customer app → turn off **Old printed QR codes still work**

## 6. Pickup screen (2026-10-04)
- [x] 6.1 Supabase → SQL Editor → New query → paste `supabase/upgrades/2026-10-pickup-screen.sql` → Run → Success
- [x] 6.2 Admin → Sell → Pickup screen → Add screen → open the link on the cafe TV → tap once → TV sleep off

## 7. FiKA Club (2026-10-04)
- [x] 7.1 Supabase → SQL Editor → New query → paste `supabase/upgrades/2026-10-club-rewards.sql` → Run → Success
- [x] 7.2 Admin → Customers → FiKA Club → check monthly tiers, milestones, Club levels and prices, birthday gift → Save

## 8. Help guide and support tickets (2026-10-04)
- [x] 8.1 Supabase → SQL Editor → New query → paste `supabase/upgrades/2026-10-support-tickets.sql` → Run → Success
- [x] 8.2 Phone: tap **?** at the top → send a test ticket → reply to it from `/superadmin` → the reply arrives on the phone

## 9. Kitchen stations (2026-10-04)
- [x] 9.1 Supabase → SQL Editor → New query → paste `supabase/upgrades/2026-10-kitchen-stations.sql` → Run → Success
- [x] 9.2 Admin → Menu → Categories → check each category's **Kitchen station** (Hot kitchen, Coffee bar, Cold)

## 10. My day tasks (2026-10-04)
- [x] 10.1 Supabase → SQL Editor → New query → paste `supabase/upgrades/2026-10-my-day.sql` → Run → Success
- [x] 10.2 Owner phone: My day → Today's tasks → **Edit** → type the cafe's daily jobs (one per line) → Save

## 11. Brand & look (2026-10-05)
- [x] 11.1 Supabase → SQL Editor → New query → paste `supabase/upgrades/2026-10-brand-identity.sql` → Run → Success
- [x] 11.2 Admin → Settings → **Brand & look** → check name, short line, address, phone and hours, upload the FiKA logo → Save

## 12. Brand & look, part 3 (2026-10-05)
- [ ] 12.1 Supabase → SQL Editor → New query → paste `supabase/upgrades/2026-10-brand-audit.sql` → Run → Success
- [ ] 12.2 (optional) Admin → Settings → **Brand & look** → **Customer app opens in** → keep "Customer's phone setting" or pick one → Save
