// Sends phone alerts for each new notification_events row.
// Called by a Supabase Database Webhook (INSERT on public.notification_events) — see RELEASES.md, Phase 5.
//
// Secrets (supabase secrets set ...):
//   PUSH_WEBHOOK_SECRET   any long random text; the webhook sends it in the x-webhook-secret header
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com)   — browser / home-screen app alerts
//   FCM_SERVICE_ACCOUNT   the Firebase service-account JSON (one line)               — Android app alerts (optional)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import { GoogleAuth } from "npm:google-auth-library@9";

type Target = { endpoint: string; keys: Record<string, string>; platform: string; style: string };

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fcm: { token: () => Promise<string>; project: string } | null = null;
function fcmClient() {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  if (fcm) return fcm;
  const credentials = JSON.parse(raw);
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
  fcm = { project: credentials.project_id, token: async () => (await auth.getAccessToken()) as string };
  return fcm;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) return reply(401, { message: "Bad webhook secret" });

  const body = await req.json().catch(() => ({}));
  const n = body.record;
  if (!n?.id) return reply(400, { message: "No record" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: targets, error } = await admin.rpc("push_targets", { p_event: n.id });
  if (error) return reply(500, { message: error.message });

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (vapidPublic && vapidPrivate) {
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com", vapidPublic, vapidPrivate);
  }

  let sent = 0;
  const gone: string[] = [];
  for (const t of (targets || []) as Target[]) {
    const payload = { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link || "/admin", style: t.style };
    try {
      if (t.platform === "web" && vapidPublic && vapidPrivate) {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: t.keys as { p256dh: string; auth: string } },
          JSON.stringify(payload), { TTL: 600, urgency: t.style === "normal" ? "normal" : "high" });
        sent++;
      } else if (t.platform === "android") {
        const client = fcmClient();
        if (!client) continue;
        // Data-only message so the app's own service can ring a full-screen alarm even when locked
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${client.project}/messages:send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${await client.token()}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token: t.endpoint,
              data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? "")])),
              android: { priority: "HIGH", ttl: "600s" },
            },
          }),
        });
        if (res.status === 404 || res.status === 400) gone.push(t.endpoint);
        else if (res.ok) sent++;
      }
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(t.endpoint);
    }
  }
  // Phones that uninstalled or turned alerts off
  if (gone.length) await admin.from("push_subscriptions").delete().in("endpoint", gone);
  return reply(200, { sent, removed: gone.length });
});
