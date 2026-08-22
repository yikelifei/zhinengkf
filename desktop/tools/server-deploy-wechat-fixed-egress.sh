#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT=/opt/smart-kefu
ENV_FILE="$ROOT/shared/runtime.env"
NGINX_FILE=/www/server/panel/vhost/nginx/kefu.zhenxiliye.cn.conf
NODE=/www/server/nodejs/v20.20.2/bin/node
NGINX=/www/server/nginx/sbin/nginx
STAGE="${1:?stage path is required}"
PUBLIC_RELAY=https://kefu.zhenxiliye.cn/wecom-api

case "$STAGE" in
  /home/lighthouse/smart-kefu-wechat-egress-*) ;;
  *) printf 'refusing unexpected stage path: %s\n' "$STAGE" >&2; exit 20 ;;
esac

current="$(readlink -f "$ROOT/current")"
case "$current" in
  "$ROOT"/releases/*/desktop) ;;
  *) printf 'refusing unexpected current release: %s\n' "$current" >&2; exit 21 ;;
esac

for required in "$ENV_FILE" "$NGINX_FILE" "$STAGE/wecom-api-fixed-egress.location.conf.template"; do
  [[ -f "$required" ]] || { printf 'missing required file: %s\n' "$required" >&2; exit 22; }
done

IFS= read -r encoded_token
relay_token="$(printf '%s' "$encoded_token" | base64 -d -i)"
[[ "$relay_token" =~ ^[a-f0-9]{64}$ ]] || { printf 'invalid relay token\n' >&2; exit 23; }
token_ref="$(printf '%s' "$relay_token" | sha256sum | cut -c1-12)"

release_id="$(date +%Y%m%d-%H%M%S)-wechat-fixed-egress"
release="$ROOT/releases/$release_id/desktop"
env_backup="$ENV_FILE.pre-wechat-fixed-egress-$release_id"
nginx_backup="$NGINX_FILE.pre-wechat-fixed-egress-$release_id"
link_changed=0
env_changed=0
nginx_changed=0
current_step=initializing

rollback() {
  trap - ERR
  set +e
  if [[ "$link_changed" == 1 ]]; then
    rollback_link="$ROOT/.rollback-$release_id"
    ln -s "$current" "$rollback_link"
    mv -Tf "$rollback_link" "$ROOT/current"
  fi
  [[ "$env_changed" == 1 ]] && cp -a "$env_backup" "$ENV_FILE"
  [[ "$nginx_changed" == 1 ]] && cp -a "$nginx_backup" "$NGINX_FILE"
  systemctl reset-failed smart-kefu-api >/dev/null 2>&1 || true
  systemctl restart smart-kefu-api >/dev/null 2>&1 || true
  "$NGINX" -t >/dev/null 2>&1 && "$NGINX" -s reload >/dev/null 2>&1 || true
  printf 'deployment failed at step=%s; production release and configuration were rolled back\n' "$current_step" >&2
  exit 1
}
trap rollback ERR

current_step=copy_release
install -d -o root -g smartkefu -m 0750 "$(dirname "$release")"
cp -a "$current" "$release"

current_step=patch_server_source
"$NODE" - "$release" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];

function update(relative, mutate) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const result = mutate(source);
  fs.writeFileSync(file, result, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`expected one patch target: ${label}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

update("apps/api/src/shared/app-config.ts", (source) => {
  if (source.includes("wechatWorkCallbackProcessingMode:")) return source;
  return replaceOnce(
    source,
    '  wechatWorkApiBaseUrl: trimTrailingSlash(process.env.WECHAT_WORK_API_BASE_URL || "https://qyapi.weixin.qq.com"),\n',
    '  wechatWorkApiBaseUrl: trimTrailingSlash(process.env.WECHAT_WORK_API_BASE_URL || "https://qyapi.weixin.qq.com"),\n'
      + '  wechatWorkCallbackProcessingMode:\n'
      + '    String(process.env.WECHAT_WORK_CALLBACK_PROCESSING_MODE || "process").trim().toLowerCase() === "signal_only"\n'
      + '      ? "signal_only" as const\n'
      + '      : "process" as const,\n',
    "callback processing mode config",
  );
});

update("apps/api/src/wechat-work/wechat-work.service.ts", (source) => {
  if (source.includes('action: "callback_sync_delegated"')) return source;
  return replaceOnce(
    source,
    '      this.callbackEvents?.publish(openKfid);\n      this.scheduleCustomerServiceSync({ token, openKfid });\n',
    '      this.callbackEvents?.publish(openKfid);\n'
      + '      if (appConfig.wechatWorkCallbackProcessingMode === "signal_only") {\n'
      + '        await this.persistence.recordWechatWorkAudit({\n'
      + '          action: "callback_sync_delegated",\n'
      + '          status: "processed",\n'
      + '          msgid: callbackId,\n'
      + '          callbackId,\n'
      + '          openKfid: openKfid || null,\n'
      + '          reason: "fixed_egress_desktop_relay",\n'
      + '        });\n'
      + '      } else {\n'
      + '        this.scheduleCustomerServiceSync({ token, openKfid });\n'
      + '      }\n',
    "callback server delegation",
  );
});
NODE

cd "$release"
current_step=build_server_api
"$NODE" node_modules/@nestjs/cli/bin/nest.js build --config apps/api/nest-cli.json
current_step=validate_server_build
chown -R root:smartkefu "$release/dist/apps/api"
find "$release/dist/apps/api" -type d -exec chmod 0750 {} +
find "$release/dist/apps/api" -type f -exec chmod 0640 {} +
runuser -u smartkefu -- test -r "$release/dist/apps/api/main.js"
grep -R -q 'callback_sync_delegated' "$release/dist/apps/api"

current_step=prepare_server_env
cp -a "$ENV_FILE" "$env_backup"
env_temp="$(mktemp /opt/smart-kefu/shared/.runtime.env.wechat-egress.XXXXXX)"
chmod --reference="$ENV_FILE" "$env_temp"
chown --reference="$ENV_FILE" "$env_temp"
found=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == WECHAT_WORK_CALLBACK_PROCESSING_MODE=* ]]; then
    # Keep production processing callbacks until the desktop relay probe passes.
    printf 'WECHAT_WORK_CALLBACK_PROCESSING_MODE=process\n'
    found=1
  else
    printf '%s\n' "$line"
  fi
done < "$ENV_FILE" > "$env_temp"
[[ "$found" == 1 ]] || printf 'WECHAT_WORK_CALLBACK_PROCESSING_MODE=process\n' >> "$env_temp"
mv -f "$env_temp" "$ENV_FILE"
env_changed=1

cp -a "$NGINX_FILE" "$nginx_backup"
current_step=render_nginx_relay
rendered="$(mktemp /tmp/smart-kefu-wechat-egress.XXXXXX)"
sed "s/__SMART_KEFU_RELAY_TOKEN__/$relay_token/g" \
  "$STAGE/wecom-api-fixed-egress.location.conf.template" > "$rendered"
"$NODE" - "$NGINX_FILE" "$rendered" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const rendered = fs.readFileSync(process.argv[3], "utf8").trim();
const begin = "    # BEGIN SMART KEFU WECOM FIXED EGRESS";
const end = "    # END SMART KEFU WECOM FIXED EGRESS";
let source = fs.readFileSync(file, "utf8");
const block = `${begin}\n${rendered.split("\n").map((line) => `    ${line}`).join("\n")}\n${end}`;
const beginIndex = source.indexOf(begin);
if (beginIndex >= 0) {
  const endIndex = source.indexOf(end, beginIndex);
  if (endIndex < 0) throw new Error("fixed-egress Nginx block is truncated");
  source = `${source.slice(0, beginIndex)}${block}${source.slice(endIndex + end.length)}`;
} else {
  const marker = "\n    location / {";
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error("HTTPS catch-all Nginx location was not found");
  source = `${source.slice(0, markerIndex)}\n${block}\n${source.slice(markerIndex)}`;
}
fs.writeFileSync(file, source, "utf8");
NODE
rm -f "$rendered"
nginx_changed=1
current_step=validate_nginx
"$NGINX" -t
nginx_dump="$("$NGINX" -T 2>&1)"
grep -Fq 'location ^~ /wecom-api/' <<< "$nginx_dump"
unset nginx_dump

current_step=activate_release
next_link="$ROOT/.current-$release_id"
ln -s "$release" "$next_link"
mv -Tf "$next_link" "$ROOT/current"
link_changed=1
systemctl restart smart-kefu-api

current_step=verify_api_health
api_ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3200/api/health | grep -q '"ok":true'; then
    api_ready=1
    break
  fi
  sleep 1
done
[[ "$api_ready" == 1 ]] || { printf 'API health acceptance failed\n' >&2; false; }

current_step=activate_nginx
"$NGINX" -s reload
current_step=verify_public_relay
origin_status=000
for _ in $(seq 1 20); do
  origin_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --resolve kefu.zhenxiliye.cn:443:127.0.0.1 "$PUBLIC_RELAY/cgi-bin/gettoken?corpid=invalid&corpsecret=invalid" || true)"
  [[ "$origin_status" == 403 ]] && break
  sleep 0.5
done
[[ "$origin_status" == 403 ]] || { printf 'local HTTPS relay returned %s\n' "$origin_status" >&2; false; }

anonymous_status=000
for _ in $(seq 1 20); do
  anonymous_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_RELAY/cgi-bin/gettoken?corpid=invalid&corpsecret=invalid" || true)"
  [[ "$anonymous_status" == 403 ]] && break
  sleep 0.5
done
[[ "$anonymous_status" == 403 ]] || { printf 'anonymous relay returned %s\n' "$anonymous_status" >&2; false; }
authorized_body=""
for _ in $(seq 1 10); do
  authorized_body="$(curl -fsS --max-time 15 -H "X-Smart-Kefu-Wechat-Api-Relay-Token: $relay_token" "$PUBLIC_RELAY/cgi-bin/gettoken?corpid=invalid&corpsecret=invalid" || true)"
  printf '%s' "$authorized_body" | grep -q '"errcode"' && break
  sleep 0.5
done
printf '%s' "$authorized_body" | grep -q '"errcode"'

server_outbound_ip="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
[[ "$server_outbound_ip" =~ ^[0-9a-fA-F:.]+$ ]] || server_outbound_ip=unverified

unset relay_token encoded_token WECHAT_WORK_API_RELAY_TOKEN
current_step=complete
trap - ERR
printf 'DEPLOYED_RELEASE=%s\n' "$release"
printf 'ROLLBACK_RELEASE=%s\n' "$current"
printf 'ENV_BACKUP=%s\n' "$env_backup"
printf 'NGINX_BACKUP=%s\n' "$nginx_backup"
printf 'RELAY_TOKEN_REF=%s\n' "$token_ref"
printf 'SERVER_OUTBOUND_IP=%s\n' "$server_outbound_ip"
printf 'API_ACTIVE=%s\n' "$(systemctl is-active smart-kefu-api)"
printf 'PUBLIC_RELAY=accepted\n'
