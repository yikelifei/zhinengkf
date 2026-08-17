"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");

test("server backup is verified, secret-free and restricted to the shared backup root", () => {
  const script = fs.readFileSync(path.join(desktopRoot, "tools", "server-postgres-backup.sh"), "utf8");
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /pg_dump/i);
  assert.match(script, /PG_RESTORE_BIN.*--list/s);
  assert.match(script, /sha256sum/);
  assert.match(script, /\/opt\/smart-kefu\/shared\/backups\/\*/);
  assert.match(script, /databaseUrlPrinted.*false/);
  assert.doesNotMatch(script, /echo\s+["']?\$DATABASE_URL/);
  assert.doesNotMatch(script, /pg_restore[^\n]*(?:--dbname|-d\s)/i);
});

test("database backup service is oneshot and timer is persistent", () => {
  const service = fs.readFileSync(path.join(desktopRoot, "config", "systemd", "smart-kefu-database-backup.service"), "utf8");
  const timer = fs.readFileSync(path.join(desktopRoot, "config", "systemd", "smart-kefu-database-backup.timer"), "utf8");
  assert.match(service, /Type=oneshot/);
  assert.match(service, /User=smartkefu/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(service, /ReadWritePaths=\/opt\/smart-kefu\/shared\/backups/);
  assert.match(timer, /OnCalendar=.*03:20:00 Asia\/Shanghai/);
  assert.match(timer, /Persistent=true/);
});
