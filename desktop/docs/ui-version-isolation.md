# UI version isolation

The modular desktop is intentionally isolated from the legacy single-page workbench.

| Version | Source | Web/API/design ports | Runtime data | Electron instance |
| --- | --- | --- | --- | --- |
| Legacy single-page | frozen legacy worktree | source archive | no shared runtime | browser-only archive |
| Modular desktop | `codex/runtime-recovery-cutover` | 3110 / 3210 / 3710 | `.runtime/ui-versions/runtime-modular` | `modular` |

Use `launch-isolated-modular-desktop.cmd` for the supported modular desktop. Use the matching `status-` and `stop-` scripts to inspect or stop only that runtime.

Historical UI branches are source archives. They must not reuse the modular ports, runtime directory, `.next` output, or Electron instance.

The modular launcher passes an instance-specific `--user-data-dir` before the Electron entry file, so Chromium process state is separated before application JavaScript starts.
