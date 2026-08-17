#!/usr/bin/env bash
set -u

DOMAIN="${DOMAIN:-kefu.zhenxiliye.cn}"
EXPECTED_IPV4="${EXPECTED_IPV4:-118.89.91.230}"
ENV_FILE="${ENV_FILE:-/opt/smart-kefu/shared/runtime.env}"
CERT_DIR="${CERT_DIR:-/www/server/panel/vhost/cert/${DOMAIN}}"
API_BASE="${API_BASE:-http://127.0.0.1:3200/api}"

pass=0
blocked=0

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'PASS    %s\n' "$label"
    pass=$((pass + 1))
  else
    printf 'BLOCKED %s\n' "$label"
    blocked=$((blocked + 1))
  fi
}

resolved_ipv4() {
  getent ahostsv4 "$DOMAIN" | awk 'NR == 1 { print $1 }'
}

dns_matches() {
  [ "$(resolved_ipv4)" = "$EXPECTED_IPV4" ]
}

certificate_ready() {
  [ -s "$CERT_DIR/fullchain.pem" ] &&
    [ -s "$CERT_DIR/privkey.pem" ] &&
    openssl x509 -checkend 86400 -noout -in "$CERT_DIR/fullchain.pem"
}

environment_value_present() {
  local name="$1"
  grep -Eq "^[[:space:]]*${name}=[^[:space:]].*" "$ENV_FILE"
}

public_base_ready() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  [ "${CUSTOMER_SERVICE_PUBLIC_BASE_URL:-}" = "https://${DOMAIN}" ]
}

wechat_aes_key_ready() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  WECHAT_AES_KEY="${WECHAT_WORK_ENCODING_AES_KEY:-}" /www/server/nodejs/v20.20.2/bin/node -e '
    const key = String(process.env.WECHAT_AES_KEY || "");
    let decoded = null;
    try { decoded = Buffer.from(`${key}=`, "base64"); } catch {}
    process.exit(key.length === 43 && decoded?.length === 32 ? 0 : 1);
  '
}

api_health_ready() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  curl -fsS --max-time 5 -H "x-internal-api-token: ${INTERNAL_API_TOKEN:-}" "$API_BASE/health" |
    grep -q '"ok":true'
}

model_config_ready() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  curl -fsS --max-time 5 -H "x-internal-api-token: ${INTERNAL_API_TOKEN:-}" "$API_BASE/ai/providers/status" |
    /www/server/nodejs/v20.20.2/bin/node -e '
      let source = "";
      process.stdin.on("data", (chunk) => { source += chunk; });
      process.stdin.on("end", () => {
        const status = JSON.parse(source);
        const providers = Array.isArray(status.providers) ? status.providers : [];
        const primary = providers.find((provider) => provider.name === status.primary);
        process.exit(status.enabled === true && primary?.configured === true && providers.some((provider) => provider.configured === true) ? 0 : 1);
      });
    '
}

check "DNS A record points to expected server" dns_matches
check "TLS certificate and private key are present and valid for more than 24 hours" certificate_ready
check "server runtime environment file exists" test -r "$ENV_FILE"
check "API health is reachable through loopback" api_health_ready
check "customer-service model configuration is ready without probing" model_config_ready
check "CUSTOMER_SERVICE_PUBLIC_BASE_URL is the expected HTTPS origin" public_base_ready

for name in WECHAT_WORK_CORP_ID WECHAT_WORK_SECRET WECHAT_WORK_TOKEN WECHAT_WORK_OPEN_KFID; do
  check "${name} is configured" environment_value_present "$name"
done
check "WECHAT_WORK_ENCODING_AES_KEY decodes to 32 bytes" wechat_aes_key_ready

printf 'SUMMARY pass=%s blocked=%s mutation_count=0\n' "$pass" "$blocked"
[ "$blocked" -eq 0 ] || exit 2
