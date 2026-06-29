#!/usr/bin/env bash
set -euo pipefail

lan_host="${FLOWIMAGE_LAN_HOST:-$(ipconfig getifaddr en0 2>/dev/null || true)}"
if [[ -z "${lan_host}" ]]; then
  lan_host="127.0.0.1"
fi

urls=(
  "${FLOWIMAGE_LOCAL_URL:-http://127.0.0.1:3939/}"
  "${FLOWIMAGE_LAN_URL:-http://${lan_host}:3939/}"
)

for url in "${urls[@]}"; do
  echo "Checking ${url}"
  curl --fail --silent --show-error --head --max-time 3 "${url}" >/dev/null
done

echo "FlowImage dev server is reachable."
