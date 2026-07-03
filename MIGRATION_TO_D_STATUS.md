# Migration to D Drive Status

Current project path:

```text
D:\zhinengkefu
```

Old C drive entry:

```text
C:\Users\27808\Desktop\zhinengkefu
```

Current state:

- The D drive copy has been built successfully.
- The old C drive entry has been reduced to empty Codex workspace folders only.
- The old C drive entry currently has 0 bytes of regular file content.
- Stable desktop helper scripts live under `D:\zhinengkefu\desktop`.
- Stable desktop runtime now uses `D:\zhinengkefu\desktop\.runtime-stable`.
- `keepalive-stable-desktop.cmd` also writes runtime and logs under `D:\zhinengkefu\desktop\.runtime-stable`.
- If stable desktop services are running from the old C drive entry, stop them before finalizing the Junction.
- Do not start stable desktop services from `C:\Users\27808\Desktop\zhinengkefu`; use `D:\zhinengkefu\desktop\start-stable-desktop.cmd`.
- Temporary wrapper scripts may exist at the old C drive entry; they only forward to the D drive scripts and are safe to remove once the Junction is created.
- A current-user Run entry is registered for the next login:

```text
FinalizeZhinengkefuMigration = cmd.exe /c D:\zhinengkefu\finalize-migration-on-next-login.cmd
```

- A current-user RunOnce entry is also registered as a one-time fallback:

```text
FinalizeZhinengkefuMigrationOnce = cmd.exe /c D:\zhinengkefu\finalize-migration-on-next-login.cmd
```

Next-login behavior:

1. Run `D:\zhinengkefu\finalize-migration-to-d.ps1`.
2. Stop D drive dev services if any are running.
3. Stop old C drive project processes that are still using `C:\Users\27808\Desktop\zhinengkefu`.
4. Remove `C:\Users\27808\Desktop\zhinengkefu`.
5. Create a Junction from `C:\Users\27808\Desktop\zhinengkefu` to `D:\zhinengkefu`.
6. Remove the Run and RunOnce entries after success. This cleanup is handled by both `finalize-migration-to-d.ps1` and `finalize-migration-on-next-login.cmd`.

Manual fallback:

```cmd
D:\zhinengkefu\finalize-migration-to-d.cmd
```

Active migration files:

```text
D:\zhinengkefu\finalize-migration-to-d.ps1
D:\zhinengkefu\finalize-migration-to-d.cmd
D:\zhinengkefu\finalize-migration-on-next-login.cmd
D:\zhinengkefu\cancel-migration-autorun.cmd
D:\zhinengkefu\verify-migration-to-d.ps1
D:\zhinengkefu\verify-migration-to-d.cmd
D:\zhinengkefu\MIGRATION_TO_D_STATUS.md
```

Cancel autorun fallback:

```cmd
D:\zhinengkefu\cancel-migration-autorun.cmd
```

This removes only the `FinalizeZhinengkefuMigration` and `FinalizeZhinengkefuMigrationOnce` current-user startup entries.

Verification helper:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\zhinengkefu\verify-migration-to-d.ps1
```

Or:

```cmd
D:\zhinengkefu\verify-migration-to-d.cmd
```

The helper also checks that D drive `.cmd` scripts no longer reference the old C drive path and reports the size of `D:\zhinengkefu\desktop\.runtime-stable`.

Verification after next login:

```powershell
Get-Item -LiteralPath "C:\Users\27808\Desktop\zhinengkefu" -Force | Format-List FullName,Attributes,LinkType,Target
reg.exe query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FinalizeZhinengkefuMigration"
reg.exe query "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v "FinalizeZhinengkefuMigrationOnce"
```

Expected result:

- `LinkType` is `Junction`.
- `Target` points to `D:\zhinengkefu`.
- The Run and RunOnce entries are absent after a successful run.
