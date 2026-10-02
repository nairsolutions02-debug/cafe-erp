// Phone OTP login via 2factor.in. Dormant: the app only calls this when built
// with VITE_OTP_LOGIN=true. Secrets: TWOFACTOR_API_KEY (supabase secrets set ...).
//
// POST { action: "send", phone }
// POST { action: "verify", phone, otp, name?, email? }
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_SECONDS = 30;
const MAX_VERIFY_ATTEMPTS = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const apiKey = Deno.env.get("TWOFACTOR_API_KEY");
  if (!apiKey) return reply(503, { message: "OTP login is not configured" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // The browser calls this with its anonymous session; that is the user we link
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return reply(401, { message: "Not signed in" });

  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return reply(400, { message: "Enter a valid 10-digit mobile number" });

  if (body.action === "send") {
    const { data: last } = await admin.from("otp_requests").select("sent_at").eq("phone", phone).maybeSingle();
    const waited = last ? (Date.now() - new Date(last.sent_at).getTime()) / 1000 : Infinity;
    if (waited < RESEND_SECONDS) {
      const retryAfter = Math.ceil(RESEND_SECONDS - waited);
      return reply(429, { message: `Please wait ${retryAfter} seconds before requesting new OTP`, retryAfter });
    }
    const res = await fetch(`https://2factor.in/API/V1/${apiKey}/SMS/${phone}/AUTOGEN`);
    const json = await res.json().catch(() => ({}));
    if (json.Status !== "Success") return reply(502, { message: "Failed to send OTP" });
    await admin.from("otp_requests").upsert({ phone, sent_at: new Date().toISOString(), attempts: 0 });
    return reply(200, { message: "OTP sent successfully", phone, otpLength: 6, expiresIn: 300 });
  }

  if (body.action === "verify") {
    const otp = String(body.otp || "").replace(/\D/g, "");
    const name = String(body.name || "").trim();

    // New customers must give a name before the OTP is spent
    const { data: existing } = await admin.from("customers").select("id, name").eq("phone", phone).maybeSingle();
    if (!name && !existing?.name) return reply(400, { message: "Name is required", requiresProfile: true });

    const { data: request } = await admin.from("otp_requests").select("attempts").eq("phone", phone).maybeSingle();
    if (!request) return reply(400, { message: "Please request an OTP first" });
    if (request.attempts >= MAX_VERIFY_ATTEMPTS) return reply(429, { message: "Too many attempts. Request a new OTP." });
    await admin.from("otp_requests").update({ attempts: request.attempts + 1 }).eq("phone", phone);

    const res = await fetch(`https://2factor.in/API/V1/${apiKey}/SMS/VERIFY3/${phone}/${otp}`);
    const json = await res.json().catch(() => ({}));
    if (json.Status !== "Success") return reply(400, { message: "Invalid OTP" });

    await admin.from("otp_requests").delete().eq("phone", phone);
    const { error } = await admin.rpc("link_customer", {
      p_user: auth.user.id, p_name: name, p_phone: phone, p_email: String(body.email || ""), p_verified: true,
    });
    if (error) return reply(400, { message: error.message });
    return reply(200, { message: "Verified" });
  }

  return reply(400, { message: "Unknown action" });
});
