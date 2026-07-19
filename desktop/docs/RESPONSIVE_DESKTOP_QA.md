# 桌面工作台响应式验收

该验收复用项目现有 Electron Chromium，不安装 Playwright 或浏览器依赖。它对当前模块化工作台执行真实渲染，并固定检查两种内容视口：

- `1536 × 960`：桌面侧栏可见，点击“消息发送”后进入 `/send/queue`。
- `390 × 844`：底部导航可见，打开“全部功能”抽屉并点击消息发送入口后进入 `/send/queue`。

每个视口都会验证页面非空、无 Next.js 错误层、页面级无横向溢出、主导航和主面板可见、交互目标可聚焦并可到达。390px 还会验证主内容为底部导航预留空间。

## 运行

先启动本地 Web/API 服务，然后在 `desktop` 目录执行：

```bat
npm.cmd run qa:responsive -- --url http://127.0.0.1:3100/
```

也可指定产物目录和超时时间：

```bat
npm.cmd run qa:responsive -- --url http://127.0.0.1:3100/ --output-dir .runtime\responsive-qa\manual --timeout-ms 120000
```

产品级验收 `npm.cmd run acceptance:e2e` 会自动启动隔离服务并调用同一探针。

## 证据与退出码

默认产物位于忽略目录 `desktop/.runtime/responsive-qa/<timestamp>/`：

- `responsive-layout-report.json`：稳定的机器可读总结。
- `responsive-layout-report.zh-CN.md`：中文验收表。
- `electron-probe.json`：逐视口 DOM、尺寸、交互和控制台证据。
- `screenshots/desktop-1536.png`、`screenshots/mobile-390.png`：真实 Chromium 截图。

退出码为 `0` 表示两个视口都通过，`1` 表示已经完成真实渲染但发现布局或控制台错误，`2` 表示 BLOCKED。服务未启动、Electron 缺失、GUI 进程崩溃或超时都会写出明确的 BLOCKED JSON/Markdown，不能被误报为通过。
