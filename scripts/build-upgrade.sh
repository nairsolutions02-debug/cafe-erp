#!/usr/bin/env bash
# Builds supabase/upgrades/<name>.sql from migration files (one transaction, paste into the SQL Editor).
# Usage: scripts/build-upgrade.sh 2026-10-phase2 "Phase 2 (counter, kitchen, money)" supabase/migrations/20261006*.sql
set -euo pipefail
name="$1"; title="$2"; shift 2
out="supabase/upgrades/${name}.sql"
{
  echo "-- Cafe ERP · ${title} upgrade (paste into Supabase -> SQL Editor -> Run, once, after the earlier upgrades)."
  echo "-- Runs as one transaction: it applies fully or not at all."
  echo "begin;"
  echo
  for f in "$@"; do echo "-- ==== $(basename "$f") ===="; cat "$f"; echo; done
  echo "commit;"
} > "$out"
echo "$out written ($(wc -l < "$out") lines)"
