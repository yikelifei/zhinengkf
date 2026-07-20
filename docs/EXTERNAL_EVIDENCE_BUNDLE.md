# 外部证据包本地校验

`external:evidence:bundle` 读取操作员明确指定的三个 JSON 报告，并对 Windows 报告引用的真实安装器与主程序做本地只读复验。它确认报告属于当前 Git `HEAD`、仍在有效期内并保持各自的失败关闭安全契约；不会访问网络、不打包、不运行数据库、迁移或恢复命令，也不发送消息。

## 前置报告

三个输入必须使用当前 schema，并包含完整的 `repositoryRevision`：

- `smart_kefu_staging_readiness_v2`：必须来自显式 `staging:readiness -- --execute`，最长有效 24 小时。
- `smart_kefu_database_recovery_rehearsal_v2`：必须来自完成的隔离恢复演练，最长有效 30 天。
- `smart_kefu_windows_package_verification_v3`：正式包证据最长有效 7 天，且 `verificationProfile=signed-release`、`repositoryClean=true`、包内 provenance 与当前 revision/版本一致，安装器和主程序签名均为 `Valid`。

旧 schema、缺失或非法 revision、非当前 `HEAD`、过期或未来时间、非 `PASS` 状态都不会被当作有效证据。声明 `PASS` 却缺少安全字段、恢复一致性、SHA-256、包内容或 Authenticode 检查的报告会记为 `FAIL`。Windows 报告中的安装器和主程序路径必须仍指向真实常规 `.exe` 文件；工具会重算实际字节数和 SHA-256，并重新调用系统 Authenticode 验证。文件缺失、符号链接、大小/hash 不符或签名无效为 `FAIL`；当前主机无法执行签名验证为 `BLOCKED`。输入包含密钥值时只报告失败，不复制该值。

## 运行

必须同时显式指定证据根目录和三个报告路径。报告路径可以相对根目录或使用根目录内的绝对路径；指向根目录之外或经链接逃逸的路径会失败。

```powershell
cd desktop
npm.cmd run external:evidence:bundle -- `
  --evidence-root C:\release-evidence\candidate-2026-07-20 `
  --staging-report staging.json `
  --recovery-report recovery.json `
  --windows-report windows.json
```

命令只向标准输出写出白名单汇总，不修改输入目录或产物。退出码为 `PASS=0`、`FAIL=1`、`BLOCKED=2`。报告中的 hash/签名声明本身不是证据；引用的两个产物在校验时必须仍可读取。

## 仍需人工补齐

Windows 包内容、哈希和 Authenticode 即使全部通过，也不能证明 SmartScreen reputation、目标机安装/卸载、快捷方式、首次启动和人工窗口验收。因此当前三类报告全部有效时，证据包仍明确保留 `manual.windows_smartscreen=BLOCKED`。未签名测试包的 `verificationProfile=unsigned-test` 只能证明本地包内容，绝不能满足正式签名项。

本工具不会改变 `release:gate` 或 `project:completion:audit` 的默认外部 `BLOCKED`；发布负责人仍需把本地校验输出与人工或平台侧证据一起附到变更单。
