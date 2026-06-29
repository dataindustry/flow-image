#!/usr/bin/env bash
set -euo pipefail

lan_host="${FLOWIMAGE_LAN_HOST:-$(ipconfig getifaddr en0 2>/dev/null || true)}"
if [[ -z "${lan_host}" ]]; then
  lan_host="127.0.0.1"
fi

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required."
  echo "Install it with: brew install mkcert"
  exit 1
fi

mkdir -p .certs
mkcert -install
mkcert \
  -cert-file .certs/flowimage.pem \
  -key-file .certs/flowimage-key.pem \
  "${lan_host}" localhost 127.0.0.1 ::1

cat <<EOF

FlowImage local HTTPS certificate created.

Start HTTPS server:
  HTTPS_CERT_PATH=.certs/flowimage.pem \\
  HTTPS_KEY_PATH=.certs/flowimage-key.pem \\
  PUBLIC_BASE_URL=https://${lan_host}:3939 \\
  corepack pnpm@11.7.0 dev:https

Configure FlowImage plugin server_url:
  https://${lan_host}:3939

For iPad:
  1. Copy the mkcert Root CA to the iPad:
     $(mkcert -CAROOT)/rootCA.pem
  2. Install the profile on iPad.
  3. Enable full trust:
     Settings -> General -> About -> Certificate Trust Settings

EOF
