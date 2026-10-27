#!/usr/bin/env bash
# Run migrations + pgTAP tests against a throwaway local PostgreSQL (no Docker needed).
# Prefer `supabase test db` when Docker is available; this is the fallback.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${UNIFLOW_PG_WORKDIR:-${TMPDIR:-/tmp}/uniflow-pgtest}"
PORT="${UNIFLOW_PG_PORT:-55432}"
DB=uniflow_test
export LC_ALL="${LC_ALL:-en_US.UTF-8}"   # macOS postmaster refuses to start without a valid locale

rm -rf "$WORK" && mkdir -p "$WORK"
initdb -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
# TCP only: unix socket paths under long temp dirs exceed the 103-byte limit
pg_ctl -D "$WORK/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$WORK/pg.log" -w start >/dev/null
trap 'pg_ctl -D "$WORK/data" -m fast stop >/dev/null' EXIT

PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "create database $DB"

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/local/supabase_shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
done
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/local/pgtap_lite.sql" >/dev/null

failed=0
for t in "$ROOT"/supabase/tests/database/*.test.sql; do
  echo "test     $(basename "$t")"
  out="$("${PSQL[@]}" -d "$DB" -t -A -f "$t" 2>&1)" || { echo "$out"; failed=1; continue; }
  echo "$out" | grep -E '^(not ok|# )' -A1 || true
  total=$(echo "$out" | grep -cE '^(ok|not ok) ' || true)
  bad=$(echo "$out" | grep -cE '^not ok ' || true)
  echo "         $((total - bad))/$total passed"
  [ "$bad" -eq 0 ] || failed=1
done
exit $failed
