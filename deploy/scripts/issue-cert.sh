#!/usr/bin/env bash
# =============================================================================
#  AZOLVE CHAT - TLS certificate for the edge proxy
#
#  Three ways to get a certificate, in order of preference for a government
#  deployment:
#
#    1. Authority CA (production)
#         ./scripts/issue-cert.sh csr
#       Produces certs/chat.csr and certs/chat.key. Send the CSR to the
#       authority's certificate team. When they return the signed certificate
#       (plus the issuing chain), save them as:
#           certs/fullchain.pem   signed cert first, then the chain
#           certs/privkey.pem     the key generated here
#       and run ./scripts/issue-cert.sh check.
#
#    2. Your own internal CA / already-issued files
#         Drop fullchain.pem and privkey.pem into ./certs and run:
#           ./scripts/issue-cert.sh check
#
#    3. Self-signed (acceptance testing only - browsers will warn)
#         ./scripts/issue-cert.sh self
#
#  The proxy reads exactly two files: certs/fullchain.pem and certs/privkey.pem.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

CERT_DIR="certs"
CRT="$CERT_DIR/fullchain.pem"
KEY="$CERT_DIR/privkey.pem"
CSR="$CERT_DIR/chat.csr"
CSR_KEY="$CERT_DIR/chat.key"
DAYS="${CERT_DAYS:-825}"

mkdir -p "$CERT_DIR"

# Pull the hostname out of PUBLIC_BASE_URL so the certificate matches the URL
# people actually type. Falls back to a placeholder if .env is not set up yet.
base_url() {
  if [ -f .env ]; then
    grep -E '^PUBLIC_BASE_URL=' .env | head -1 | cut -d= -f2- || true
  fi
}
BASE_URL="$(base_url)"
BASE_URL="${BASE_URL:-https://chat.example.gov.ae}"
HOST="$(printf '%s' "$BASE_URL" | sed -E 's#^[a-z]+://##; s#/.*$##; s#:[0-9]+$##')"
HOST="${HOST:-chat.example.gov.ae}"

need_openssl() {
  command -v openssl >/dev/null 2>&1 || { echo "  openssl is required." >&2; exit 1; }
}

# Shared subject. O and OU are what the authority's reviewers look for.
subject() {
  printf '/C=AE/ST=Dubai/L=Dubai/O=Government of Dubai/OU=AZOLVE CHAT/CN=%s' "$HOST"
}

# A SAN extension is mandatory: browsers and the Android WebView both ignore
# the legacy CN field. Without subjectAltName the app cannot load the site.
san_config() {
  local out="$1"
  cat > "$out" <<EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = $HOST
EOF
  # If the host is an IP literal, add it as an IP SAN instead of a DNS SAN.
  if printf '%s' "$HOST" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    sed -i.bak 's/^DNS\.1 = .*/IP.1 = '"$HOST"'/' "$out" && rm -f "$out.bak"
  fi
}

cmd_self() {
  need_openssl
  if [ -f "$CRT" ] && [ -f "$KEY" ]; then
    echo "  $CRT and $KEY already exist. Remove them first to regenerate."
    exit 1
  fi
  local cfg; cfg="$(mktemp)"
  san_config "$cfg"
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days "$DAYS" \
    -keyout "$KEY" -out "$CRT" -subj "$(subject)" -extensions v3_req \
    -config <(cat /etc/ssl/openssl.cnf 2>/dev/null || true; echo "[v3_req]"; cat "$cfg") \
    >/dev/null 2>&1 || {
      # Some minimal images have no openssl.cnf; retry with an ad-hoc config.
      openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days "$DAYS" \
        -keyout "$KEY" -out "$CRT" -subj "$(subject)" \
        -addext "subjectAltName=DNS:$HOST" \
        -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1
    }
  rm -f "$cfg"
  chmod 600 "$KEY"
  echo "  Self-signed certificate created for $HOST (valid $DAYS days)."
  echo "  Browsers and the mobile app will show a trust warning until this is"
  echo "  replaced by an authority-signed certificate."
  cmd_check || true
}

cmd_csr() {
  need_openssl
  if [ -f "$CSR" ]; then
    echo "  $CSR already exists. Remove it first to regenerate."
    exit 1
  fi
  local cfg; cfg="$(mktemp)"
  san_config "$cfg"
  openssl req -new -newkey rsa:2048 -nodes -sha256 \
    -keyout "$CSR_KEY" -out "$CSR" -subj "$(subject)" >/dev/null 2>&1
  chmod 600 "$CSR_KEY"
  rm -f "$cfg"
  echo "  Created:"
  echo "    $CSR       send this to the certificate authority"
  echo "    $CSR_KEY   keep this; it is the private key for that CSR"
  echo
  echo "  The CSR requests CN=$HOST with subjectAltName DNS:$HOST."
  echo "  When the signed certificate comes back, save the certificate and its"
  echo "  issuing chain as $CRT, then copy $CSR_KEY to $KEY and run:"
  echo "    ./scripts/issue-cert.sh check"
}

cmd_check() {
  need_openssl
  local ok=1
  for f in "$CRT" "$KEY"; do
    if [ ! -f "$f" ]; then echo "  MISSING: $f" >&2; ok=0; fi
  done
  [ "$ok" = 1 ] || exit 1

  # The proxy will refuse to start if key and certificate do not match, so
  # check that here where the error message is readable.
  local crt_mod key_mod
  crt_mod="$(openssl x509 -noout -modulus -in "$CRT" 2>/dev/null | openssl sha256 | awk '{print $NF}')"
  key_mod="$(openssl rsa -noout -modulus -in "$KEY" 2>/dev/null | openssl sha256 | awk '{print $NF}')"
  if [ "$crt_mod" != "$key_mod" ]; then
    echo "  ERROR: $CRT and $KEY do not belong together." >&2
    exit 1
  fi

  echo "  Certificate:"
  openssl x509 -noout -subject -issuer -dates -in "$CRT" | sed 's/^/    /'

  # Warn, but do not fail, when the certificate does not cover the hostname in
  # PUBLIC_BASE_URL - that is a very common cause of "app shows blank screen".
  if ! openssl x509 -noout -ext subjectAltName -in "$CRT" 2>/dev/null | grep -q "$HOST"; then
    echo "  WARNING: the certificate does not list $HOST in subjectAltName." >&2
    echo "           Users opening $BASE_URL will get a certificate error." >&2
  fi

  if openssl x509 -noout -checkend 0 -in "$CRT" >/dev/null 2>&1; then
    echo "  Certificate is currently valid."
  else
    echo "  ERROR: the certificate has expired." >&2
    exit 1
  fi
}

case "${1:-}" in
  self)  cmd_self ;;
  csr)   cmd_csr ;;
  check) cmd_check ;;
  *)
    cat <<EOF
  Usage: ./scripts/issue-cert.sh <command>

    self    create a self-signed certificate (acceptance testing only)
    csr     create a certificate signing request for the authority's CA
    check   verify that certs/fullchain.pem and certs/privkey.pem match,
            cover $HOST, and have not expired
EOF
    exit 2
    ;;
esac
