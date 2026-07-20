const OS_ENV_KEYS = [
  "PATH", "Path", "SystemRoot", "WINDIR", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR",
  "PSModulePath", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "OS", "SystemDrive", "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER", "NUMBER_OF_PROCESSORS", "NODE_OPTIONS", "NODE_PATH",
];

const OBSERVER_ENV_KEYS = [
  ...OS_ENV_KEYS, "NODE_ENV", "API_PORT", "DESKTOP_RUNTIME_DIR", "WECHAT_WINDOW_OBSERVER_API_BASE",
  "WECHAT_WINDOW_OBSERVER_CONFIG_FILE", "WECHAT_WINDOW_OBSERVER_INTERVAL_MS", "WECHAT_WINDOW_OBSERVER_PROOF_FILE",
  "WECHAT_WINDOW_OBSERVER_REQUEST_TIMEOUT_MS", "WECHAT_WINDOW_OBSERVER_SCAN", "WECHAT_WINDOW_OBSERVER_STATUS_FILE",
  "WECHAT_WINDOW_SNAPSHOT_INBOX_DIR",
];

export function buildWindowObserverChildEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const allowed = new Set(OBSERVER_ENV_KEYS.map((key) => key.toUpperCase()));
  return Object.fromEntries(
    Object.entries({ ...baseEnv, ...overrides }).filter(
      ([key, value]) => value !== undefined && allowed.has(key.toUpperCase()),
    ),
  );
}
