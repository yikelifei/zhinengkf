#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT=/opt/smart-kefu
ENV_FILE="$ROOT/shared/runtime.env"
NGINX_FILE=/www/server/panel/vhost/nginx/kefu.zhenxiliye.cn.conf
NODE=/www/server/nodejs/v20.20.2/bin/node
NGINX=/www/server/nginx/sbin/nginx
STAGE="${1:?stage path is required}"
PUBLIC_URL=https://kefu.zhenxiliye.cn/api/wechat-work/events/stream

case "$STAGE" in
  /home/lighthouse/smart-kefu-wechat-realtime-*) ;;
  *) printf 'refusing unexpected stage path: %s\n' "$STAGE" >&2; exit 20 ;;
esac

current="$(readlink -f "$ROOT/current")"
case "$current" in
  "$ROOT"/releases/*/desktop) ;;
  *) printf 'refusing unexpected current release: %s\n' "$current" >&2; exit 21 ;;
esac
for required in \
  "$ENV_FILE" \
  "$NGINX_FILE" \
  "$STAGE/wechat-work-callback-events.ts" \
  "$STAGE/wechat-work-callback-event-client.service.ts"; do
  [[ -f "$required" ]] || { printf 'missing required file: %s\n' "$required" >&2; exit 22; }
done

IFS= read -r encoded_token
token="$(printf '%s' "$encoded_token" | base64 -d -i)"
[[ "$token" =~ ^[a-f0-9]{64}$ ]] || { printf 'invalid event stream token\n' >&2; exit 23; }
token_ref="$(printf '%s' "$token" | sha256sum | cut -c1-12)"

release_id="$(date +%Y%m%d-%H%M%S)-wechat-realtime"
release="$ROOT/releases/$release_id/desktop"
case "$release" in
  "$ROOT"/releases/*/desktop) ;;
  *) printf 'invalid release path: %s\n' "$release" >&2; exit 24 ;;
esac
[[ ! -e "$release" ]] || { printf 'release already exists: %s\n' "$release" >&2; exit 25; }

env_backup="$ENV_FILE.pre-wechat-realtime-$release_id"
nginx_backup="$NGINX_FILE.pre-wechat-realtime-$release_id"
env_changed=0
nginx_changed=0
link_changed=0

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
  printf 'deployment failed; production release and configuration were rolled back\n' >&2
  exit 1
}
trap rollback ERR

install -d -o root -g smartkefu -m 0750 "$(dirname "$release")"
cp -a "$current" "$release"
install -o root -g smartkefu -m 0644 "$STAGE/wechat-work-callback-events.ts" \
  "$release/apps/api/src/wechat-work/wechat-work-callback-events.ts"
install -o root -g smartkefu -m 0644 "$STAGE/wechat-work-callback-event-client.service.ts" \
  "$release/apps/api/src/wechat-work/wechat-work-callback-event-client.service.ts"

"$NODE" - "$release" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];

function update(relative, mutate) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const result = mutate(source);
  if (result === source) throw new Error(`patch made no change: ${relative}`);
  fs.writeFileSync(file, result, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`expected one patch target: ${label}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

update("apps/api/src/shared/app-config.ts", (source) => replaceOnce(
  source,
  '  wechatWorkAutoSyncLimit: Math.max(1, Math.min(1000, numberEnv("WECHAT_WORK_AUTO_SYNC_LIMIT", 100))),\n',
  '  wechatWorkAutoSyncLimit: Math.max(1, Math.min(1000, numberEnv("WECHAT_WORK_AUTO_SYNC_LIMIT", 100))),\n'
    + '  wechatWorkRemoteEventUrl: process.env.WECHAT_WORK_REMOTE_EVENT_URL || "",\n'
    + '  wechatWorkRemoteEventToken: process.env.WECHAT_WORK_REMOTE_EVENT_TOKEN || "",\n',
  "app config callback event settings",
));

update("apps/api/src/app.module.ts", (source) => {
  source = replaceOnce(
    source,
    'import { WechatWorkSuiteApiClient } from "./wechat-work/wechat-work-suite-api.client";\n',
    'import { WechatWorkSuiteApiClient } from "./wechat-work/wechat-work-suite-api.client";\n'
      + 'import { WechatWorkCallbackEventClientService } from "./wechat-work/wechat-work-callback-event-client.service";\n'
      + 'import { WechatWorkCallbackEventRelay } from "./wechat-work/wechat-work-callback-events";\n',
    "app module callback event imports",
  );
  return replaceOnce(
    source,
    '    WechatWorkAuthorizationService,\n    WechatWorkService,\n',
    '    WechatWorkAuthorizationService,\n'
      + '    WechatWorkCallbackEventRelay,\n'
      + '    WechatWorkCallbackEventClientService,\n'
      + '    WechatWorkService,\n',
    "app module callback event providers",
  );
});

update("apps/api/src/wechat-work/wechat-work.controller.ts", (source) => {
  source = replaceOnce(
    source,
    'import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from "@nestjs/common";\n',
    'import { Body, Controller, ForbiddenException, Get, Header, Headers, Optional, Param, Post, Query, Sse, UseGuards } from "@nestjs/common";\n',
    "controller Nest imports",
  );
  source = replaceOnce(
    source,
    'import { WechatWorkService } from "./wechat-work.service";\n',
    'import { WechatWorkService } from "./wechat-work.service";\n'
      + 'import { WechatWorkCallbackEventClientService } from "./wechat-work-callback-event-client.service";\n'
      + 'import { callbackEventTokenMatches, WechatWorkCallbackEventRelay, WECHAT_WORK_CALLBACK_EVENT_TOKEN_HEADER } from "./wechat-work-callback-events";\n',
    "controller callback event imports",
  );
  source = replaceOnce(
    source,
    '  constructor(private readonly wechatWork: WechatWorkService) {}\n',
    '  constructor(\n'
      + '    private readonly wechatWork: WechatWorkService,\n'
      + '    @Optional() private readonly callbackEvents?: WechatWorkCallbackEventRelay,\n'
      + '    @Optional() private readonly callbackEventClient?: WechatWorkCallbackEventClientService,\n'
      + '  ) {}\n',
    "controller constructor",
  );
  return replaceOnce(
    source,
    '  @Get("callback")\n',
    '  @Sse("events/stream")\n'
      + '  streamCallbackEvents(@Headers(WECHAT_WORK_CALLBACK_EVENT_TOKEN_HEADER) token?: string) {\n'
      + '    if (!callbackEventTokenMatches(process.env.WECHAT_WORK_EVENT_STREAM_EXPORT_TOKEN, token)) {\n'
      + '      throw new ForbiddenException("invalid callback event stream token");\n'
      + '    }\n'
      + '    if (!this.callbackEvents) throw new ForbiddenException("callback event stream unavailable");\n'
      + '    return this.callbackEvents.stream();\n'
      + '  }\n\n'
      + '  @Get("events/status")\n'
      + '  @RequireOperatorCapability("view_console")\n'
      + '  @UseGuards(OperatorAccessGuard)\n'
      + '  getCallbackEventStatus() {\n'
      + '    return this.callbackEventClient?.status() || { configured: false, connected: false, endpoint: null };\n'
      + '  }\n\n'
      + '  @Get("callback")\n',
    "controller callback event routes",
  );
});

update("apps/api/src/wechat-work/wechat-work.service.ts", (source) => {
  source = replaceOnce(
    source,
    'import { WechatWorkAuthorizationService } from "./wechat-work-authorization.service";\n',
    'import { WechatWorkAuthorizationService } from "./wechat-work-authorization.service";\n'
      + 'import { WechatWorkCallbackEventRelay } from "./wechat-work-callback-events";\n',
    "service callback event import",
  );
  source = replaceOnce(
    source,
    '    @Optional() private readonly authorization?: WechatWorkAuthorizationService,\n  ) {\n',
    '    @Optional() private readonly authorization?: WechatWorkAuthorizationService,\n'
      + '    @Optional() private readonly callbackEvents?: WechatWorkCallbackEventRelay,\n'
      + '  ) {\n',
    "service constructor",
  );
  source = replaceOnce(
    source,
    '      this.scheduleCustomerServiceSync({ token, openKfid });\n',
    '      this.callbackEvents?.publish(openKfid);\n'
      + '      this.scheduleCustomerServiceSync({ token, openKfid });\n',
    "callback publish",
  );
  return replaceOnce(
    source,
    '  private scheduleCustomerServiceSync(payload: { token: string; openKfid?: string }) {\n',
    '  async handleRemoteCallbackSignal(payload: { openKfid?: string; eventId?: string }) {\n'
      + '    const openKfid = String(payload.openKfid || appConfig.wechatWorkOpenKfid || "").trim();\n'
      + '    if (!openKfid) throw new BadRequestException("openKfid is required for remote callback signal");\n'
      + '    await this.persistence.recordWechatWorkAudit({\n'
      + '      action: "remote_callback_signal_received",\n'
      + '      status: "processed",\n'
      + '      callbackId: String(payload.eventId || "").trim() || null,\n'
      + '      openKfid,\n'
      + '    });\n'
      + '    this.scheduleCustomerServiceSync({ openKfid });\n'
      + '    return { accepted: true, openKfid };\n'
      + '  }\n\n'
      + '  private scheduleCustomerServiceSync(payload: { token?: string; openKfid?: string }) {\n',
    "remote callback handler",
  );
});
NODE

cd "$release"
"$NODE" node_modules/@nestjs/cli/bin/nest.js build --config apps/api/nest-cli.json
chown -R root:smartkefu "$release/dist/apps/api"
find "$release/dist/apps/api" -type d -exec chmod 0750 {} +
find "$release/dist/apps/api" -type f -exec chmod 0640 {} +
for runtime_file in \
  dist/apps/api/wechat-work/wechat-work-callback-events.js \
  dist/apps/api/wechat-work/wechat-work-callback-event-client.service.js \
  dist/apps/api/wechat-work/wechat-work.controller.js \
  dist/apps/api/wechat-work/wechat-work.service.js; do
  [[ -s "$runtime_file" ]] || { printf 'missing built runtime file: %s\n' "$runtime_file" >&2; false; }
done
runuser -u smartkefu -- test -r "$release/dist/apps/api/main.js"

cp -a "$ENV_FILE" "$env_backup"
env_temp="$(mktemp /opt/smart-kefu/shared/.runtime.env.wechat-realtime.XXXXXX)"
chmod --reference="$ENV_FILE" "$env_temp"
chown --reference="$ENV_FILE" "$env_temp"
found=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == WECHAT_WORK_EVENT_STREAM_EXPORT_TOKEN=* ]]; then
    printf 'WECHAT_WORK_EVENT_STREAM_EXPORT_TOKEN=%s\n' "$token"
    found=1
  else
    printf '%s\n' "$line"
  fi
done < "$ENV_FILE" > "$env_temp"
[[ "$found" == 1 ]] || printf 'WECHAT_WORK_EVENT_STREAM_EXPORT_TOKEN=%s\n' "$token" >> "$env_temp"
mv -f "$env_temp" "$ENV_FILE"
env_changed=1

cp -a "$NGINX_FILE" "$nginx_backup"
"$NODE" - "$NGINX_FILE" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const route = "/api/wechat-work/events/stream";
let source = fs.readFileSync(file, "utf8");
if (!source.includes(`location = ${route}`)) {
  const marker = "\n    location / {";
  const index = source.lastIndexOf(marker);
  if (index < 0) throw new Error("HTTPS catch-all location marker was not found");
  const block = `
    # Dedicated authenticated callback signal stream for the trusted desktop API.
    location = ${route} {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_buffering off;
        proxy_cache off;
        add_header X-Accel-Buffering no;
        proxy_connect_timeout 5s;
        proxy_send_timeout 1h;
        proxy_read_timeout 1h;
    }
`;
  source = `${source.slice(0, index)}${block}${source.slice(index)}`;
  fs.writeFileSync(file, source, "utf8");
}
NODE
nginx_changed=1
"$NGINX" -t

next_link="$ROOT/.current-$release_id"
ln -s "$release" "$next_link"
mv -Tf "$next_link" "$ROOT/current"
link_changed=1
systemctl restart smart-kefu-api

api_ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3200/api/health | grep -q '"ok":true'; then
    api_ready=1
    break
  fi
  sleep 1
done
[[ "$api_ready" == 1 ]] || { printf 'API health acceptance failed\n' >&2; false; }

internal_stream="$(
  curl -sS --max-time 3 \
    -H "x-wechat-work-event-stream-token: $token" \
    http://127.0.0.1:3200/api/wechat-work/events/stream || true
)"
printf '%s' "$internal_stream" | grep -q 'smart_kefu_wechat_work_callback_event_v1'

"$NGINX" -s reload
"$NGINX" -T 2>/dev/null | grep -q 'location = /api/wechat-work/events/stream'
anonymous_status=000
for _ in $(seq 1 20); do
  anonymous_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$PUBLIC_URL" || true)"
  [[ "$anonymous_status" == 403 ]] && break
  sleep 0.5
done
[[ "$anonymous_status" == 403 ]] || { printf 'public anonymous stream returned %s\n' "$anonymous_status" >&2; false; }
public_stream=""
for _ in $(seq 1 10); do
  public_stream="$(
    curl -sS --max-time 3 \
      -H "x-wechat-work-event-stream-token: $token" \
      "$PUBLIC_URL" || true
  )"
  printf '%s' "$public_stream" | grep -q 'smart_kefu_wechat_work_callback_event_v1' && break
  sleep 0.5
done
printf '%s' "$public_stream" | grep -q 'smart_kefu_wechat_work_callback_event_v1'

unset token encoded_token WECHAT_WORK_EVENT_STREAM_EXPORT_TOKEN
trap - ERR
printf 'DEPLOYED_RELEASE=%s\n' "$release"
printf 'ROLLBACK_RELEASE=%s\n' "$current"
printf 'ENV_BACKUP=%s\n' "$env_backup"
printf 'NGINX_BACKUP=%s\n' "$nginx_backup"
printf 'TOKEN_REF=%s\n' "$token_ref"
printf 'API_ACTIVE=%s\n' "$(systemctl is-active smart-kefu-api)"
printf 'PUBLIC_STREAM=accepted\n'
