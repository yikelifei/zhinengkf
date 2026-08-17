# 服务器最小安全整改清单（2026-08-06）

目标服务器：`118.89.91.230`，OpenCloudOS 9.6，宝塔面板。

## 已核对事实

- 业务 API `127.0.0.1:3200`、Web `127.0.0.1:3100`、PostgreSQL `127.0.0.1:5432`、Redis 和设计平台均未绑定公网地址。
- 公网实测可达：`80`、宝塔 `8888`。
- 公网实测不可达：`443`（尚无证书/监听）、`888`、`3000`、`23575`。
- Nginx 的 `888` 是 phpMyAdmin 虚拟主机，但 host firewall 未放行，当前外网不可达。
- firewalld 的历史规则 `20/21`、`23575`、`39000-40000`、公网 `3000` 已从运行时和永久配置删除；当前仅保留 `22/80/443/8888`。
- SSH 当前允许公钥和密码，且 `PermitRootLogin yes`、`PasswordAuthentication yes`。
- 独立运维账号 `lighthouse` 已安装专用 SSH 公钥，并已在第二个会话验证 `sudo -n` 可用；root/密码入口暂未关闭。
- `smart-kefu-api` 使用独立 `smartkefu` 用户，并启用了 `NoNewPrivileges`、`ProtectSystem=full`、`PrivateTmp`、`PrivateDevices` 等 systemd 限制。
- 客服域名虚拟主机只代理 `/api/wechat-work/callback` 精确路径，其他路径返回 `404`。

## 本轮已完成

1. 删除未使用的 FTP、Docker TCP API、被动 FTP 和公网 `3000` 防火墙规则。
2. 删除前的 firewalld 规则已备份到 `/opt/smart-kefu/shared/security/firewalld-before-20260806T123951Z.txt`。
3. 业务 API、Web、PostgreSQL、Redis 和设计平台继续仅监听回环地址。
4. 已验证 `lighthouse` 公钥登录和无交互 sudo，可作为后续收紧 SSH 前的独立运维通道。

## 上线前仍须处理

1. 在腾讯云安全组把 `8888` 仅放行到固定管理员公网 IP；若没有固定 IP，则仅在维护窗口临时放行，用完关闭。
2. 保留 `80/443` 公网访问；`80` 仅用于 ACME challenge 和固定 `404`，`443` 仅公开企业微信 callback 精确路径。
3. 云安全组中的 `22` 优先限制为管理员 IP，不影响腾讯云控制台的应急登录能力后再执行。

## SSH 改造顺序

不能直接关闭 root/密码登录。正确顺序：

1. 已完成：使用现有独立运维用户 `lighthouse` 并验证 sudo 权限。
2. 已完成：安装独立 SSH 公钥。
3. 已完成：在第二个会话真实登录并完成 `sudo -n` 验证。
4. 待人工确认腾讯云控制台救援入口可用。
5. 再设置 `PasswordAuthentication no`；是否禁用 root 直登单独决定。
6. 执行 `sshd -t` 后 reload，不直接 restart；新会话验证成功后才关闭旧会话。

## 本轮不自动修改的原因

- 当前不知道用户是否依赖宝塔公网入口或动态公网 IP。
- 直接收紧 `8888`、`22` 或 root 密码登录可能造成运维失联。
- 这些改动不影响备案期间的业务预发布进度，应在确认管理员来源 IP 和应急入口后单独执行。

安全组和主机防火墙整改完成后，应同时保留：规则截图、`firewall-cmd --list-all`、公网端口复测和第二会话 SSH 登录证据。
