#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ]; then
  PU="${PUID:-1000}"
  PG="${PGID:-1000}"
  mkdir -p "${CONFIG_DIR:-/config}"
  chown -R "$PU:$PG" "${CONFIG_DIR:-/config}" || true
  exec gosu "$PU:$PG" "$@"
fi
exec "$@"
