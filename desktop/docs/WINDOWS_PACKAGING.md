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

流程按顺序生成 Prisma Client、构建 Nest API、构建 Next standalone，然后运行 electron-builder。`package:win:dir` 先生成 `win-unpacked` 便于检查；`package:win:test` 生成 `SmartKefu-Setup-<version>-x64.exe` 并自动执行包验证。

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
- 安装包 SHA-256；
- 可执行文件和安装器的 Authenticode 状态。

报告写入 `release/windows/verification/latest.{json,md}`。

## 版本、安装和卸载

发版前由发布负责人更新版本并重新生成 lock：

```powershell
npm.cmd version 0.2.0 --no-git-tag-version
```

NSIS 默认按当前用户安装，允许用户选择目录，并创建桌面和开始菜单快捷方式。卸载程序删除应用文件，但保留 `%APPDATA%/Smart Kefu`，防止误删客户数据；清理用户数据必须由操作者另行确认并备份。

当前没有自动更新发布配置，也不会自动上传产物。安装包只在签名验证、预发布安装/卸载和真实环境验收都通过后才能对外发布。
