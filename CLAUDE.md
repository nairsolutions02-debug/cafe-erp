# Instructions for Claude in this repo

## Gate: pending setup comes first (owner's explicit instruction, 2026-10-03)
Before starting ANY new feature, phase or build work in this repository, open `PENDING-SETUP.md`.
If any box is still unticked:
1. Do not start the new work. Say so plainly, list the unticked steps, and offer to walk through the next one.
2. Answer questions, fix bugs and help with the setup steps themselves — those are allowed.
3. Proceed with new work only after every box is ticked, or the owner says in that conversation, in so many words,
   to skip a specific step (then tick it as "skipped" with the date).
Never ask for or accept the VAPID private key, the Supabase secret key, the database password or Firebase JSON contents in chat.

## Conventions
- Every push to main gets a `RELEASES.md` entry with deploy steps and a test checklist, and schema changes ship as a
  one-paste file in `supabase/upgrades/` (built with `scripts/build-upgrade.sh`).
