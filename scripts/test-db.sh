#!/usr/bin/env bash
# Start a throwaway PostgreSQL 16+ cluster for integration tests and load the Supabase shim
# plus all migrations. Usage: scripts/test-db.sh start|stop|reset
# Prints the connection URL on start. If you run `supabase start` instead, point
# TEST_DATABASE_URL at the CLI database and the shim is skipped automatically.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.tmp/pgdata"
PORT="${TEST_DB_PORT:-54329}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); fi
URL="postgresql://postgres@127.0.0.1:$PORT/wbh_test"

start() {
  mkdir -p "$ROOT/.tmp"
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DATA"; [ "$(id -u)" = "0" ] && chown -R postgres "$ROOT/.tmp"
    "${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
  fi
  if ! "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
    "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$ROOT/.tmp/pg.log" -w start >/dev/null
  fi
  reset
  echo "$URL"
}

reset() {
  psql -q -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c "drop database if exists wbh_test with (force)" -c "create database wbh_test" >/dev/null
  psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d wbh_test -f "$ROOT/tests/integration/support/supabase-shim.sql" >/dev/null
  for f in "$ROOT"/supabase/migrations/*.sql; do
    psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d wbh_test -f "$f" >/dev/null
  done
}

stop() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null || true; }

case "${1:-start}" in
  start) start ;;
  reset) reset; echo "$URL" ;;
  stop) stop ;;
  *) echo "usage: $0 start|stop|reset" >&2; exit 2 ;;
esac
