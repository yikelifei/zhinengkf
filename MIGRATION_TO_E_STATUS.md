# Migration to E Drive Status

Updated: 2026-07-23

## Active paths

- Canonical physical repository: `E:\zhinengkefu`
- Desktop shortcut: `C:\Users\27808\Desktop\run.bat.lnk` targets `E:\zhinengkefu\run.bat`
- Old C-drive Junction: removed after active links were repointed to `E:\zhinengkefu`
- Rollback copy retained at: `D:\zhinengkefu`

All future development, Git commands, launchers, runtime data, and new Codex worktrees should use `E:\zhinengkefu` as the repository root.

## Migration result

- Copied 692,226 files, totaling 24.500 GB according to Robocopy.
- No file copy failures occurred.
- 100 inaccessible directories were skipped; all observed failures were pytest caches or temporary pytest runtime directories.
- Repaired all 192 registered Git worktrees against the E-drive common Git directory.
- Verified all 192 worktree forward and back references.
- Removed the old `FinalizeZhinengkefuMigration` and `FinalizeZhinengkefuMigrationOnce` registry entries that pointed to D drive.
- Converted stable desktop launchers from hard-coded D-drive paths to script-relative paths.
- Retained `D:\zhinengkefu` as a rollback copy; do not develop in it.

## Verification

```powershell
Test-Path -LiteralPath "C:\Users\27808\Desktop\zhinengkefu"

git -C E:\zhinengkefu rev-parse --show-toplevel
git -C E:\zhinengkefu worktree list
git -C E:\zhinengkefu status --short --branch
```

Expected results:

- The old C-drive project entry is absent.
- Git top level is `E:/zhinengkefu`.
- Worktree paths use `E:/zhinengkefu/...`, except the two intentionally external Codex worktrees under `C:/Users/27808/.codex/worktrees/...`.

## Rollback policy

Do not delete `D:\zhinengkefu` until the E-drive project has passed normal development/build/runtime use. If rollback is needed, stop project services, repair worktree pointers back to the D-drive common Git directory, and only then retarget the C-drive Junction.
