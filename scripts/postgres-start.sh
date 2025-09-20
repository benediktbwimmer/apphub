#!/bin/bash
set -euo pipefail

DATA_DIR="${PGDATA:-/app/data/postgres}"
POSTGRES_USER="${POSTGRES_USER:-apphub}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-apphub}"
POSTGRES_DB="${POSTGRES_DB:-apphub}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

# Ensure PostgreSQL binaries (initdb, pg_ctl, postgres) are on PATH for the postgres user.
PG_BINDIR="$(pg_config --bindir 2>/dev/null || true)"
if [[ -n "$PG_BINDIR" ]]; then
  PATH_PREFIX="PATH=$PG_BINDIR:\$PATH"
else
  PATH_PREFIX="PATH=\$PATH"
fi

run_as_postgres() {
  local cmd=("$@")
  local quoted_cmd
  quoted_cmd=$(printf ' %q' "${cmd[@]}")
  # shellcheck disable=SC2086 # quoted_cmd is intentionally expanded by su -c
  su -s /bin/bash postgres -c "$PATH_PREFIX${quoted_cmd}"
}

initialize_database() {
  mkdir -p "$DATA_DIR"
  chown -R postgres:postgres "$DATA_DIR"

  if [[ ! -s "$DATA_DIR/PG_VERSION" ]]; then
    run_as_postgres initdb -D "$DATA_DIR"

    run_as_postgres pg_ctl -D "$DATA_DIR" -o "-c listen_addresses='127.0.0.1' -c port=$POSTGRES_PORT" -w start

    if ! run_as_postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$POSTGRES_USER'" | grep -q 1; then
      run_as_postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$POSTGRES_USER\" LOGIN PASSWORD '$POSTGRES_PASSWORD';"
    else
      run_as_postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE \"$POSTGRES_USER\" WITH PASSWORD '$POSTGRES_PASSWORD';"
    fi

    if ! run_as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | grep -q 1; then
      run_as_postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"
    fi

    run_as_postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE \"$POSTGRES_USER\" WITH SUPERUSER CREATEDB CREATEROLE;"

    run_as_postgres pg_ctl -D "$DATA_DIR" -m fast stop
  else
    chown -R postgres:postgres "$DATA_DIR"
  fi
}

start_server() {
  exec su -s /bin/bash postgres -c "$PATH_PREFIX exec postgres -D \"$DATA_DIR\" -c listen_addresses=127.0.0.1 -c port=$POSTGRES_PORT"
}

initialize_database
start_server
