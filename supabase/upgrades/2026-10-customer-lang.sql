-- Cafe ERP · Customer app languages: optional Hindi dish name upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades).
-- Runs as one transaction: it applies fully or not at all.
begin;

-- ==== 20261028000001_customer_lang.sql ====
-- Customer app in Hindi and Hinglish: an optional Hindi name per dish, shown small under the dish name to customers
-- who use the app in Hindi. Bills keep the main name. No apostrophes in comments: the SQL Editor splitter treats them as quotes.

alter table public.menu_items add column if not exists name_hi text not null default ''
    check (char_length(name_hi) <= 120);

commit;
