-- Dormant OTP login support (used only by the phone-otp Edge Function when
-- the otp_login_enabled setting is true).

insert into public.settings (key, value, description)
values ('otp_login_enabled', 'false', 'Require SMS OTP for customer login')
on conflict (key) do nothing;

-- Last OTP send per phone, for resend cooldown (service role only)
create table public.otp_requests (
    phone text primary key,
    sent_at timestamptz not null default now(),
    attempts integer not null default 0
);
alter table public.otp_requests enable row level security;

-- Lets the Edge Function link a verified phone to the caller's session
grant execute on function public.link_customer(uuid, text, text, text, boolean) to service_role;
