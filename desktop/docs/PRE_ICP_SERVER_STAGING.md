# 备案期间服务器预发布方案

这份方案只解决“域名尚未备案，但服务器已经存在时，项目如何继续落地”。目标是先得到可重复的服务器内部证据，不提前开放公网入口，也不把 `BLOCKED` 伪装成正式上线。

## 当前结论

- 可以现在完成：独立 PostgreSQL、Redis、依赖安装、构建、迁移、API 健康、持久队列和只读预发布报告。
- 必须等备案和 HTTPS：企业微信公网回调、真实入站、受控发送和公开域名验收。
- 不能直接公开：当前操作员鉴权只支持本机桌面会话，还没有企业 SSO；完整 Web/API 不得直接暴露到公网。
- 暂不在服务器关闭：`art_image_local` 依赖同机运行的臻希 AI。若服务器没有臻希 AI，本项保持 `BLOCKED`，不改接未知接口。
- 当前工作区仍有大量混合改动，不能整目录上传服务器。服务器应用部署必须绑定后续隔离出的固定 Git revision。

## 备案期间拓扑

```text
本机浏览器
  -> SSH 隧道
    -> 服务器 127.0.0.1:3100 (Web)
      -> 服务器 127.0.0.1:3200 (API)
        -> 私网/本机 PostgreSQL
        -> 私网/本机 Redis
```

防火墙只保留运维入口。`3100`、`3200`、`5432`、`6379` 不开放公网；Web 启动时也必须显式绑定 `127.0.0.1`。

## 第一阶段：准备基础设施

1. 确认服务器操作系统、CPU 架构、可用内存/磁盘以及 SSH 或远程管理入口。
2. 安装 Node.js 20 或更高版本、npm 10 或更高版本、PostgreSQL 和 Redis。
3. 创建独立数据库 `smart_kefu_staging` 和独立最小权限账号，不使用 `postgres/postgres`、`admin/admin` 等默认凭据。
4. Redis 使用独立 ACL 用户和密码，开启持久化与故障告警；禁止公网访问。
5. 从 `config/pre-icp-staging.env.example` 生成真实配置文件，放在仓库外的受限目录。Linux 可使用 `/etc/smart-kefu/pre-icp.env`，Windows 可使用 `C:\ProgramData\SmartKefu\pre-icp.env`。
6. 同一份真实配置必须注入 API 和 Web 进程。`DESKTOP_ENV_FILE` 只会帮助 API 读取文件，不能替代 Web 进程的环境变量注入。

备案期间保留以下保护：

- `WECHAT_PRODUCT_MODE=enterprise_wechat_only`
- `WECHAT_SEND_ADAPTER=dry_run`
- `LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE=0`
- `ALLOW_DEMO_DATA_MUTATIONS=0`
- `PERSONAL_WECHAT_SEND=0`

## 第二阶段：部署固定版本

只有发布候选版本完成隔离并得到固定 revision 后，才把该 revision 部署到服务器。不要上传当前混乱工作区。

在服务器的 `desktop` 目录执行：

```text
npm ci --ignore-scripts
npm run prisma:generate
npm run build
npm exec -- prisma migrate deploy --schema prisma/schema.prisma
```

迁移前先备份目标库。预发布和生产都禁止运行 `prisma migrate dev`。

进程管理器需要启动两个长期进程：

```text
API: node dist/apps/api/main.js
Web: node apps/web/.next/standalone/apps/web/server.js
```

API 已固定监听 `127.0.0.1:3200`。Web 必须注入 `HOSTNAME=127.0.0.1` 和 `PORT=3100`，不能使用 standalone server 默认的 `0.0.0.0`。

## 第三阶段：只读验收

先离线检查独立配置，不访问网络：

```text
npm run staging:readiness -- --env-file <真实配置文件绝对路径>
```

API、PostgreSQL 和 Redis 启动后，再显式执行只读检查：

```text
npm run staging:readiness -- --env-file <真实配置文件绝对路径> --execute --api-base http://127.0.0.1:3200/api
```

`--execute` 只运行 `prisma migrate status` 和固定的 `GET` 请求，不部署迁移、不发消息、不提交设计任务。报告写入 `desktop/.runtime/staging-readiness-evidence/`，不包含密钥明文。

备案期间允许以下结果保持 `BLOCKED`：

- 企业微信公网回调与历史审计。
- 同机臻希 AI 未部署时的设计平台就绪。
- 正式 Windows 签名与真实客户机器验收。
- 公开 Web 的企业 SSO 与逐人审计。

以下结果不能继续带 `FAIL`：

- 运行模式与 Prisma 持久化。
- PostgreSQL URL 安全策略。
- API 回环访问和内部令牌。
- Redis durable 配置、连接、固定 scheduler 和单并发 Worker。
- 仓库代码构建、迁移状态和 `/api/health` 的 `dataMode=prisma`。

## 本机查看方式

服务器上的 Web 不开放公网。运维人员从本机建立 SSH 隧道：

```text
ssh -L 3100:127.0.0.1:3100 -L 3200:127.0.0.1:3200 <用户>@<服务器>
```

然后只在本机打开 `http://127.0.0.1:3100`。这要求预发布配置临时使用 `ALLOW_LOCAL_BROWSER_WEB_API=1`；任何公网 Web 方案启用前必须改回 `0`，并先完成企业 SSO/服务端操作员身份。

## 备案完成后的切换

1. 配置公网 HTTPS 反向代理，只公开确有需要的入口；企业微信回调应直接转发到 `/api/wechat-work/callback`，不要公开 `3200` 端口。
2. 将 `CUSTOMER_SERVICE_PUBLIC_BASE_URL` 改为备案域名的 HTTPS 地址。
3. 注入企业微信凭据并切换 `WECHAT_SEND_ADAPTER=wechat_work_kf`。
4. 在企业微信后台登记 URL、Token 和 EncodingAESKey，完成真实回调、入站和人工批准发送验收。
5. 重新运行只读预发布检查和交付 handoff。所有外部证据齐全前，`productionReleaseAllowed` 必须保持 `false`。
