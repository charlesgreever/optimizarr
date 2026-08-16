#!/bin/sh
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
TZ="${TZ:-UTC}"

if [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" > /etc/timezone
fi

if ! getent group "$PGID" >/dev/null 2>&1; then
  groupadd -g "$PGID" optimizarr
fi

if ! getent passwd "$PUID" >/dev/null 2>&1; then
  useradd -u "$PUID" -g "$PGID" -d /config -M -s /usr/sbin/nologin optimizarr
fi

mkdir -p /config
chown -R "$PUID:$PGID" /config

export CONFIG_DIR="${CONFIG_DIR:-/config}"
export WEB_ROOT="${WEB_ROOT:-/app/dist/web}"

exec gosu "$PUID:$PGID" node /app/dist/server.js
