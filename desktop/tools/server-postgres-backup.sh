#!/usr/bin/env bash
set -euo pipefail
umask 0077

ENV_FILE="${ENV_FILE:-/opt/smart-kefu/shared/runtime.env}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/smart-kefu/shared/backups/daily}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_DUMP_BIN="${PG_DUMP_BIN:-/www/server/pgsql/bin/pg_dump}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-/www/server/pgsql/bin/pg_restore}"

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || [ "$RETENTION_DAYS" -lt 1 ] || [ "$RETENTION_DAYS" -gt 90 ]; then
  printf 'invalid retention period\n' >&2
  exit 1
fi

resolved_backup_root="$(readlink -m "$BACKUP_ROOT")"
case "$resolved_backup_root" in
  /opt/smart-kefu/shared/backups/*) ;;
  *)
    printf 'backup root must remain under /opt/smart-kefu/shared/backups\n' >&2
    exit 1
    ;;
esac

for required in "$ENV_FILE" "$PG_DUMP_BIN" "$PG_RESTORE_BIN"; do
  if [ ! -r "$required" ]; then
    printf 'required backup input is unavailable: %s\n' "$required" >&2
    exit 1
  fi
done

install -d -m 700 "$resolved_backup_root"
exec 9>"$resolved_backup_root/.backup.lock"
if ! flock -n 9; then
  printf 'database backup is already running\n' >&2
  exit 0
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
if [ -z "${DATABASE_URL:-}" ]; then
  printf 'DATABASE_URL is not configured\n' >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
filename="smartkefu-daily-${stamp}.dump"
temporary_path="$resolved_backup_root/.${filename}.partial"
final_path="$resolved_backup_root/$filename"
checksum_path="$final_path.sha256"

cleanup() {
  rm -f -- "$temporary_path"
}
trap cleanup EXIT

"$PG_DUMP_BIN" --format=custom --compress=6 --no-owner --no-acl --file "$temporary_path" "$DATABASE_URL"
"$PG_RESTORE_BIN" --list "$temporary_path" >/dev/null
if [ ! -s "$temporary_path" ]; then
  printf 'database backup is empty\n' >&2
  exit 1
fi

mv -- "$temporary_path" "$final_path"
sha256sum "$final_path" >"$checksum_path"
chmod 600 "$final_path" "$checksum_path"

find "$resolved_backup_root" -maxdepth 1 -type f -name 'smartkefu-daily-*.dump' -mtime "+$RETENTION_DAYS" -print0 |
  while IFS= read -r -d '' expired_dump; do
    case "$expired_dump" in
      "$resolved_backup_root"/smartkefu-daily-*.dump)
        rm -f -- "$expired_dump" "$expired_dump.sha256"
        ;;
    esac
  done

size_bytes="$(stat -c %s "$final_path")"
checksum="$(sha256sum "$final_path" | awk '{print $1}')"
printf '{"status":"PASS","verifiedWith":"pg_restore --list","file":"%s","sizeBytes":%s,"sha256":"%s","retentionDays":%s,"databaseUrlPrinted":false}\n' \
  "$final_path" "$size_bytes" "$checksum" "$RETENTION_DAYS"
