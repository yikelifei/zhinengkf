# Windows 桌面打包与交付

## 定位

Windows 包使用固定版本 `electron-builder 26.15.3` 和 `Electron 42.5.0`，目标为 x64 NSIS 安装器。`package:win:test` 只生成本地未签名测试包；正式交付必须使用 `package:win:signed` 并通过 Authenticode 校验。

electron-builder 官方说明：应用默认使用 asar；`files` 控制应用内容，`extraResources` 将指定文件复制到 Windows `resources`；NSIS 是 Windows 安装器目标；生产应用应签名。本项目据此采用显式白名单，不使用源码根目录通配打包。

官方依据：[Application Contents](https://www.electron.build/contents/)、[File Patterns](https://www.electron.build/file-patterns/)、[NSIS](https://www.electron.build/nsis/)、[Windows Code Signing](https://www.electron.build/code-signing-win.html)、[electron-builder npm](https://www.npmjs.com/package/electron-builder)。

## 构建

在 `desktop` 目录执行：

```powershell
npm.cmd ci
npm.cmd run package:win:dir
npm.cmd run package:win:test
```

流程按顺序生成 Prisma Client、构建 Nest API、以 `FORCE_WEB_CLEAN_BUILD=1` 强制重建 Next standalone，然后运行 electron-builder。Windows 打包不复用已有 Web 产物；任一构建失败都不会生成 provenance。`package:win:dir` 先生成 `win-unpacked` 便于检查；`package:win:test` 生成 `SmartKefu-Setup-<version>-x64.exe` 并自动执行包验证。

未签名构建会设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，验证报告必须显示 `BLOCKED`，不能作为正式发布包。正式签名使用：

```powershell
$env:CSC_LINK = "C:\secure\company-code-signing.pfx"
$env:CSC_KEY_PASSWORD = "<从安全凭据系统注入>"
npm.cmd run package:win:signed
```

也可由受控构建机设置 `WIN_CSC_SUBJECT_NAME` 使用证书存储中的证书。证书和密码不得写入仓库、`.env`、构建配置或安装包。

## 随包运行结构

- `resources/app.asar`：Electron main/preload、packaged runtime 和生产依赖。
- `resources/services/api/main.js`：编译后的 Nest API。
- `resources/services/web/apps/web/server.js`：Next standalone 服务。
- `resources/services/runtime-root`：只读规则、窗口观察器和仅含环境变量占位符的 AI 配置；API child 以该目录为 cwd。
- `%APPDATA%/Smart Kefu/runtime`：运行状态。
- `%APPDATA%/Smart Kefu/storage`：本地业务数据。
- `%APPDATA%/Smart Kefu/config/runtime.env`：可选的部署侧运行配置，不随安装包分发。
- `%APPDATA%/Smart Kefu/logs`：本地服务日志。

安装目录只保存只读程序资源。Electron 使用 `process.resourcesPath` 找到随包服务，并使用 `app.getPath("userData")` 隔离运行数据，不依赖源码目录。API 中历史 `process.cwd()` 读取会落到只读 `runtime-root`；所有写路径仍由 `DESKTOP_RUNTIME_DIR`、`LOCAL_STORAGE_ROOT` 和 `DESKTOP_ENV_FILE` 显式指向用户数据目录。

## 白名单与验证

打包白名单只包含三个 Electron 入口、`package.json`、生产依赖、API 编译输出和 Web standalone。配置显式排除 `.env*`、`.runtime`、`storage`、`logs`、`*.log`、私钥/证书文件和 source map。

`npm.cmd run package:win:verify` 检查：

- 版本和 Electron main 入口；
- Windows 可执行文件、asar、API/Web 入口；
- asar 和 resources 中的敏感文件负证据；
- 使用打包后的 EXE 在独立 32191/32190 端口启动 API 和 Web，验证规则/Prisma 加载、`/overview`、Next 静态资源和 Web `/api/health` 代理；
- 就绪探测使用 `INTERNAL_API_TOKEN` 与本次启动的 `DESKTOP_WEB_SESSION_PROOF` 生成 API/Web 两段 HMAC；仅返回固定健康 JSON、忽略或反射 cookie 的监听器不能通过；
- 安装包 SHA-256；
- 可执行文件和安装器的 Authenticode 状态。

报告写入 `release/windows/verification/latest.{json,md}`。

报告 schema 为 `smart_kefu_windows_package_verification_v3`，JSON 和 Markdown 都记录完整 Git `repositoryRevision`、`repositoryClean` 与 `verificationProfile`。打包在构建前及全部构建成功、调用 electron-builder 前各检查一次 Git worktree；dirty、无 Git 或期间 HEAD 变化都会失败。只有二次 HEAD/clean 检查通过后，构建工具才生成临时 `.package-provenance.json` 并收入 asar；验证时要求其中的 revision、clean 标记和版本与当前干净 HEAD 完全一致，完成后删除临时文件。`package:win:signed` 使用 `signed-release`；未签名测试包使用 `unsigned-test`；仅检查目录内容时使用 `content-only`。

外部证据包只接受当前 `HEAD`、7 天内生成、状态为 `PASS` 的 `signed-release`，但报告中的 `checks[].status`、历史 smoke JSON 和 `Valid` 字样都不能替代现场复核。验证器只把版本化安装器和 `win-unpacked` 纳入白名单快照，并对文件数、总字节、目录深度及单文件大小执行上限；从 evidence root 到安装器、`resources`、`app.asar` 和 services 的每一级路径都会拒绝符号链接、junction/reparse point、硬链接及未知节点。私有临时目录携带随机所有权标记与目录身份，清理前会原子改名并再次核对，调用者提供的 runtime 目录绝不会成为递归删除目标。源树与快照在验证前后都计算逐文件 SHA-256 清单，以检测中途变化。

正式签名身份由 `config/windows-release-signing-policy.json` 控制，必须在受控发布变更中把 `identityStatus` 改为 `CONFIGURED`，并填写公司证书的精确 publisher subject 与 thumbprint。当前仓库故意保持 `UNCONFIGURED`，所以任何文件即使显示 Authenticode `Valid` 也只能 `BLOCKED`，不能成为正式签名证据。原生验证不信任 `SystemRoot`、`windir` 或 `PATH`，只接受规范 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`；无法取得可信系统目录时保持 `BLOCKED`。同时核对 product name、original filename、版本和 x64 PE，不得把 Microsoft 或其他厂商的已签名 EXE 当作项目证据。

安装器内容绑定使用 electron-builder 自身缓存的 `7zip@1.0.0`，其版本与可执行文件 SHA-256 固定在 `config/windows-release-extractor-policy.json`。验证器不通过 `NODE_PATH` 加载 extractor，且拒绝哈希不符、歧义、junction/reparse point 或硬链接的缓存项。它先提取 electron-builder NSIS，再提取唯一 `app-64.7z`，完整清单必须与快照的 `win-unpacked` 一致；缺少固定版本 extractor 属于 `BLOCKED`，已存在但被替换、解析超时或 payload 不一致属于 `FAIL`。

现场复核顺序固定为：白名单哈希与包内容 → 原生 Authenticode/发布者策略 → NSIS payload 绑定 → packaged runtime smoke。前置任一项未通过时绝不执行包内 EXE。Runtime smoke 仅传递最小 OS 环境与内部创建的临时目录，在隔离端口 32191/32190 进行 localhost 探测，并使用可靠的 Windows 进程树终止与退出确认；包自身启动或响应超时是 `FAIL`，只有明确端口占用、平台或工具缺失才是 `BLOCKED`。历史 `packaged-api-smoke.json` 单独不能令该项通过。

外部证据报告会如实记录私有临时写入、系统工具执行、包内 runtime 执行和 localhost 探测。最小环境与临时目录不是 OS 沙箱；高风险或来源未受信的工件仍应在 Windows Sandbox 或一次性虚拟机中复核。

即使 `signed-release` 报告通过，SmartScreen reputation、目标机安装/卸载和人工启动仍不在该报告结构内，必须继续作为人工 `BLOCKED` 补证；未签名报告绝不能满足正式签名项。

## 版本、安装和卸载

发版前由发布负责人更新版本并重新生成 lock：

```powershell
npm.cmd version 0.2.0 --no-git-tag-version
```

NSIS 默认按当前用户安装，允许用户选择目录，并创建桌面和开始菜单快捷方式。卸载程序删除应用文件，但保留 `%APPDATA%/Smart Kefu`，防止误删客户数据；清理用户数据必须由操作者另行确认并备份。

当前没有自动更新发布配置，也不会自动上传产物。安装包只在签名验证、预发布安装/卸载和真实环境验收都通过后才能对外发布。
