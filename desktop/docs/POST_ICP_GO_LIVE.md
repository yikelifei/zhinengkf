# 备案通过后的分阶段上线清单

适用目标：`kefu.zhenxiliye.cn`，服务器 `118.89.91.230`。这不是“备案日期一到就自动上线”的脚本；只有官方备案状态已通过、DNS 已生效、证书已签发后才进入下一阶段。

## 当前已完成

- API、Web、PostgreSQL、Redis/BullMQ 已在服务器运行，业务端口只监听回环地址。
- 服务器版本已绑定固定 revision，数据库迁移为最新状态。
- 隔离恢复演练已通过：源库和恢复库均为 33 张表、18 条迁移，演练库随后已删除。
- PostgreSQL 已配置每日自校验备份，保留 14 天；每个备份均生成 SHA256，并先通过 `pg_restore --list`。
- 客服模型配置已安全注入服务器；主模型和备用模型的最小 `pong` 探测均通过。
- 企业微信回调 Token 和 EncodingAESKey 已在服务器本地生成并安全保存，正式发送仍保持关闭。
- 公网 Nginx 只转发企业微信 callback 精确路径，其他路径返回 `404`；完整 Web/API 不对公网开放。

## 现在只需要准备

1. 保留企业微信管理员权限，确认目标能力是“微信客服”，不是个人微信和普通自建应用消息。
2. 准备微信客服的 CorpID、Secret 和 OpenKfId。Token 和 EncodingAESKey 已由服务器生成，不需要重新创建，也不要把现有值发在普通聊天里。
3. 备案通过前保持：
   - `WECHAT_SEND_ADAPTER=dry_run`
   - `LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE=0`
   - `PERSONAL_WECHAT_SEND=0`

## 门槛一：备案、DNS 和证书

通过条件：

- 工信部备案状态已正式通过，不以预计日期代替。
- `kefu.zhenxiliye.cn` 的 A 记录解析为 `118.89.91.230`。
- 宝塔为该域名签发有效证书，文件位于：
  - `/www/server/panel/vhost/cert/kefu.zhenxiliye.cn/fullchain.pem`
  - `/www/server/panel/vhost/cert/kefu.zhenxiliye.cn/privkey.pem`

服务器只读预检命令：

```bash
/opt/smart-kefu/shared/tooling/post-icp-server-preflight.sh
```

当前预期结果为 `pass=7 blocked=4 mutation_count=0`；备案和企业微信材料齐全后应为 `blocked=0`。

操作顺序：

1. 备份 `/www/server/panel/vhost/nginx/kefu.zhenxiliye.cn.conf`。
2. 使用 `config/nginx/kefu.zhenxiliye.cn.post-icp.conf` 替换该虚拟主机配置。
3. 执行 `/www/server/nginx/sbin/nginx -t`；失败立即恢复备份，不 reload。
4. 配置检查通过后 reload Nginx。
5. 从公网验证证书、域名和 callback 路径。无签名 callback 返回 `400` 是预期安全行为；根路径应继续返回 `404`。

这一阶段仍保持 `WECHAT_SEND_ADAPTER=dry_run`，不会真实发送消息。

## 门槛二：企业微信回调

将以下变量注入 `/opt/smart-kefu/shared/runtime.env`，权限保持 `640 root:smartkefu`：

```text
CUSTOMER_SERVICE_PUBLIC_BASE_URL=https://kefu.zhenxiliye.cn
WECHAT_WORK_CORP_ID=<微信客服所属企业 CorpID>
WECHAT_WORK_SECRET=<微信客服 Secret>
WECHAT_WORK_TOKEN=<保留服务器现有值>
WECHAT_WORK_ENCODING_AES_KEY=<保留服务器现有值>
WECHAT_WORK_OPEN_KFID=<目标客服帐号 OpenKfId>
WECHAT_SEND_ADAPTER=dry_run
```

在企业微信后台填写：

```text
URL: https://kefu.zhenxiliye.cn/api/wechat-work/callback
Token: 与服务器 WECHAT_WORK_TOKEN 完全一致
EncodingAESKey: 与服务器 WECHAT_WORK_ENCODING_AES_KEY 完全一致
```

通过条件：

- 企业微信后台 URL 验证成功。
- 测试客户发送一条真实消息后，审计出现 `callback_accepted` 和 `inbound_processed`。
- `GET /api/wechat-work/status` 报告 Prisma 持久化和身份映射正常。

回调失败时保持 `dry_run`，只修正域名、证书、Token/AESKey 或权限，不尝试绕过验签。

## 门槛三：一次受控发送

只有门槛二通过后：

1. 将 `WECHAT_SEND_ADAPTER` 改为 `wechat_work_kf`，重启 API。
2. 保持 `LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE=0`，禁止自动消费发送队列。
3. 由工作台人工批准一条无价格、退款或承诺内容的测试回复。
4. 只处理这一个测试任务，核对 `WechatSendAttempt` 和企业微信审计记录。
5. 客户端真实收到消息后，才记录受控发送通过。

任何网络结果不确定、异步失败或部分发送都不能重放；先回到 `dry_run` 并人工复核。

## 门槛四：最终只读报告

在服务器重新执行：

```text
/www/server/nodejs/v20.20.2/bin/node \
  /opt/smart-kefu/shared/tooling/20260806/tools/staging-readiness-evidence.js \
  --execute \
  --api-base http://127.0.0.1:3200/api \
  --env-file /opt/smart-kefu/shared/runtime.env \
  --repository-revision edb48dd9c70fa0db9e2dae11b7fa8028cb8978d71cc7529bde31e1ce47617db8 \
  --repository-root /opt/smart-kefu/releases/20260806-173604 \
  --desktop-root /opt/smart-kefu/current \
  --report-root /opt/smart-kefu/shared/staging-readiness-evidence-v2
```

报告必须包含真实 callback、入站和受控发送审计。只读健康检查、端口在线或模拟数据不能代替这些证据。

## 回滚

1. 立即设置 `WECHAT_SEND_ADAPTER=dry_run` 并重启 API。
2. 不删除发送尝试、回调或入站审计记录。
3. HTTPS 配置失败时恢复 Nginx 备份并重新执行 `nginx -t` 后 reload。
4. 数据库结构问题使用已验证的恢复流程处理，不对当前业务库运行演练还原。

完整 Web 工作台仍只允许 SSH 隧道访问。未完成企业 SSO 和逐人审计前，不把 `3100`、`3200` 或任意 `/api` 通配路径开放到公网。
