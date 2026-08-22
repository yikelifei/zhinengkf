#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT=/opt/smart-kefu
ENV_FILE="$ROOT/shared/runtime.env"
backup="$ENV_FILE.pre-wechat-signal-only-$(date +%Y%m%d-%H%M%S)"
[[ -f "$ENV_FILE" ]] || { printf 'runtime env missing\n' >&2; exit 20; }
cp -a "$ENV_FILE" "$backup"

rollback() {
  trap - ERR
  set +e
  cp -a "$backup" "$ENV_FILE"
  systemctl restart smart-kefu-api >/dev/null 2>&1 || true
  printf 'signal-only activation failed and runtime env was restored\n' >&2
  exit 1
}
trap rollback ERR

temp="$(mktemp /opt/smart-kefu/shared/.runtime.env.signal-only.XXXXXX)"
chmod --reference="$ENV_FILE" "$temp"
chown --reference="$ENV_FILE" "$temp"
found=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == WECHAT_WORK_CALLBACK_PROCESSING_MODE=* ]]; then
    printf 'WECHAT_WORK_CALLBACK_PROCESSING_MODE=signal_only\n'
    found=1
  else
    printf '%s\n' "$line"
  fi
done < "$ENV_FILE" > "$temp"
[[ "$found" == 1 ]] || printf 'WECHAT_WORK_CALLBACK_PROCESSING_MODE=signal_only\n' >> "$temp"
mv -f "$temp" "$ENV_FILE"

systemctl restart smart-kefu-api
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3200/api/health | grep -q '"ok":true'; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || { printf 'API health acceptance failed\n' >&2; false; }
grep -q '^WECHAT_WORK_CALLBACK_PROCESSING_MODE=signal_only$' "$ENV_FILE"

trap - ERR
printf 'SIGNAL_ONLY_ACTIVE=true\n'
printf 'ENV_BACKUP=%s\n' "$backup"
