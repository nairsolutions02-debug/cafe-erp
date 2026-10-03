# Pending setup — finish this before anything new gets built

Owner: Pravin. Started 2026-10-03 (combined Phase 2–7 SQL already run on FiKA).
Tick each box (`[x]`) as you finish it and push, or tell Claude "done: <step>".

## 1. Phone alerts when the app is closed
- [x] 1.1 Generate push keys (Windows: PowerShell; Mac: Terminal): `npx web-push generate-vapid-keys` (keep the private key secret — never paste it in chat)
- [x] 1.2 Vercel → FiKA project → Settings → Environment Variables → `VITE_VAPID_PUBLIC_KEY` = public key → Redeploy
- [ ] 1.3 Supabase → Edge Functions → Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:nairsolutions02@gmail.com`), `PUSH_WEBHOOK_SECRET` (Windows PowerShell: `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`; Mac: `openssl rand -hex 24`)
- [ ] 1.4 Deploy: `git pull` → `npx supabase login` → `npx supabase functions deploy push-notify --project-ref <ref> --no-verify-jwt`
- [ ] 1.5 Supabase → Database → Webhooks → `push` on `notification_events` INSERT → Edge Function `push-notify`, header `x-webhook-secret`
- [ ] 1.6 Test: My day → Turn on alerts → close the browser → QR order from another phone → notification arrives

## 2. Android staff app (optional, but decide yes/no)
- [ ] 2.1 Firebase project + Android app (package e.g. `in.nairsolutions.fika`) → `google-services.json` → GitHub secret `GOOGLE_SERVICES_JSON`
- [ ] 2.2 Firebase service-account JSON → Supabase secret `FCM_SERVICE_ACCOUNT`
- [ ] 2.3 (optional) Signing key → GitHub secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- [ ] 2.4 GitHub → Actions → Android app → Run workflow → download APK → install on one staff phone → My day → Phone setup all green → Test alarm

## 3. Setup inside the app (FiKA)
- [ ] 3.1 Attendance → stand in the cafe → Use my location → Save
- [ ] 3.2 Attendance → link every employee to their staff login; set shift start
- [ ] 3.3 Recipes & Costing → recipes for the top 10–15 dishes
- [ ] 3.4 Reports → Profit target → monthly (and weekly) target
- [ ] 3.5 Rewards → Customer portal → Google review link + cafe Instagram username → Save

Full click-by-click steps: `RELEASES.md` → Phase 5 (sections 1–2) and the Phase 5–7 checklists (section 3).
