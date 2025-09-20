#!/bin/bash
set -euo pipefail

DATA_DIR="${PGDATA:-/app/data/postgres}"
POSTGRES_USER="${POSTGRES_USER:-apphub}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-apphub}"
POSTGRES_DB="${POSTGRES_DB:-apphub}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

initialize_database() {
  mkdir -p "$DATA_DIR"
  chown -R postgres:postgres "$DATA_DIR"

  if [ ! -s "$DATA_DIR/PG_VERSION" ]; then
    su -s /bin/bash postgres -c "initdb -D '$DATA_DIR'"

    su -s /bin/bash postgres -c "pg_ctl -D '$DATA_DIR' -o \"-c listen_addresses='127.0.0.1' -c port=$POSTGRES_PORT\" -w start"

    if ! su -s /bin/bash postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname = '$POSTGRES_USER'\"" | grep -q 1; then
      su -s /bin/bash postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE ROLE \""$POSTGRES_USER"\" LOGIN PASSWORD '$POSTGRES_PASSWORD';\""
    else
      su -s /bin/bash postgres -c "psql -v ON_ERROR_STOP=1 -c \"ALTER ROLE \""$POSTGRES_USER"\" WITH PASSWORD '$POSTGRES_PASSWORD';\""
    fi

    if ! su -s /bin/bash postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'\"" | grep -q 1; then
      su -s /bin/bash postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE DATABASE \""$POSTGRES_DB"\" OWNER \""$POSTGRES_USER"\";\""
    fi

    su -s /bin/bash postgres -c "psql -v ON_ERROR_STOP=1 -c \"ALTER ROLE \""$POSTGRES_USER"\" WITH SUPERUSER CREATEDB CREATEROLE;\""

    su -s /bin/bash postgres -c "pg_ctl -D '$DATA_DIR' -m fast stop"
  else
    chown -R postgres:postgres "$DATA_DIR"
  fi
}

start_server() {
  exec su -s /bin/bash postgres -c "postgres -D '$DATA_DIR' -c listen_addresses='127.0.0.1' -c port=$POSTGRES_PORT"
}

initialize_database
start_server
