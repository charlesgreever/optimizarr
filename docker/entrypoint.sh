#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ]; then
  PU="${PUID:-1000}"
  PG="${PGID:-1000}"
  mkdir -p "${CONFIG_DIR:-/config}"
  chown -R "$PU:$PG" "${CONFIG_DIR:-/config}" || true
  extra=""
  for gid in $(id -G); do
    [ "$gid" = "0" ] && continue
    [ "$gid" = "$PG" ] && continue
    extra="${extra:+$extra,}$gid"
  done
  groups="$PG"
  [ -n "$extra" ] && groups="$PG,$extra"
  exec setpriv --reuid="$PU" --regid="$PG" --groups="$groups" --inh-caps=-all -- "$@"
fi
exec "$@"
