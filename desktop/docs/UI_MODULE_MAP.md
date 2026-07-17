# UI 模块与路由地图

本文档定义工作台路由地基的所有权。目标是让页面像积木一样独立组合：一个 URL 对应一个完整用户目标，页面只加载本域数据，跨域动作只负责导航。

## 路由地基

- `apps/web/src/app/route-manifest.ts` 是唯一的类型化路由清单，记录页面标题、唯一职责、主操作、工作台模块和旧书签。
- `apps/web/src/app/**/page.tsx` 只能选择一个路由或做明确的兼容重定向，不承载业务状态、请求或样式。
- `apps/web/src/app/legacy-workbench.tsx` 是迁移期兼容层；新功能不得继续加入该文件。功能分支应逐页迁往 `features/<domain>`。
- 侧栏使用真实 `Link`。模块内切换使用 `router.push`，旧根页面哈希只在 `/` 转换一次，因此深链、刷新、前进和后退都由 URL 驱动。
- `loading.tsx`、`error.tsx`、`not-found.tsx` 与 `route-state.tsx` 提供路由级状态。业务 feature 仍需独立实现权限态和本域空态。

## 生产页面责任

| 域 | 页面 | 唯一职责 | 主操作 |
| --- | --- | --- | --- |
| 总览 | `/overview` | 查看全局经营、通道、发送与自动化状态 | 刷新总览 |
| 会话 | `/conversations` | 筛选并选择客户会话 | 打开会话 |
| 会话 | `/conversations/[id]` | 处理一条会话及其人工接管、分配和回复入队 | 人工回复入队 |
| 路由 | `/routing` | 评估或纠正消息路由 | 判断谁来处理 |
| 发送 | `/send/queue` | 处理已通过守卫的发送队列 | 安全处理队列 |
| 发送 | `/send/blocked` | 处理阻塞或不确定投递 | 解除明确阻塞并重排 |
| 发送 | `/send/diagnostics` | 诊断适配器、窗口和回执 | 刷新诊断 |
| 接入 | `/integrations/channels` | 查看所有通道状态并导航到配置或验收页 | 刷新通道 |
| 企业微信 | `/integrations/wechat-work` | 做本地配置检查和只读上线预检 | 运行只读预检 |
| 个人微信 | `/integrations/personal-wechat/instances` | 管理 RPA 实例、端点与账号绑定 | 保存实例 |
| 个人微信 | `/integrations/personal-wechat/control` | 查看账号、Windows 会话和窗口隔离 | 刷新控制面 |
| 个人微信 | `/integrations/personal-wechat/safety` | 查看同意、频控、敏感内容和审计 | 全局停止 |
| 设计 | `/design/settings` | 配置设计平台连接 | 保存配置 |
| 设计 | `/design/assets` | 上传、选择和预览客户素材 | 上传素材 |
| 设计 | `/design/jobs` | 筛选和创建设计任务 | 新建设计任务 |
| 设计 | `/design/jobs/[id]` | 完成一条设计任务的预检、提交、轮询、选图或取消 | 提交当前任务 |
| 商品 | `/catalog/products` | 管理商品资料 | 新增商品 |
| 商品 | `/catalog/repair` | 修复资料和图片问题 | 保存当前修复 |
| 商品 | `/catalog/import` | 完成商品导入向导 | 确认入库 |
| 商品 | `/catalog/audit` | 查看商品库的自动化资格 | 刷新体检 |
| 商品 | `/catalog/bundles` | 验证预算和场景搭配 | 生成搭配建议 |
| 销售 | `/sales/quotes` | 管理报价 | 新建或发送报价 |
| 销售 | `/sales/quotes/[id]` | 处理一条报价的修订、核验、发送或建单 | 发送当前报价 |
| 销售 | `/sales/orders` | 管理订单跟进 | 打开待处理订单 |
| 销售 | `/sales/orders/[id]` | 按真实前置条件推进一条订单 | 执行当前可用下一步 |
| 自动化 | `/automation/runs` | 控制自动化并查看当前与最近运行 | 运行一轮 |
| 自动化 | `/automation/issues` | 处理自动化卡点 | 处理第一项 |
| 提醒 | `/notifications` | 阅读并定位业务提醒 | 全部已读 |
| Agent | `/agents` | 查看 Agent 及其适用范围 | 打开 Agent |
| 训练 | `/training/import` | 导入对话训练材料 | 导入训练 |
| 训练 | `/training/review` | 复核训练样本 | 确认所选样本 |
| 训练 | `/training/skills` | 审核和应用 Skill 建议 | 应用已审核建议 |
| 审核 | `/reviews/inbox` | 处理人工接管队列 | 处理第一项 |
| 审核 | `/reviews/design` | 审核设计结果 | 批准或要求改图 |
| 审核 | `/reviews/quotes` | 审核报价 | 通过并入队 |
| 审核 | `/reviews/orders` | 审核订单确认和跟进 | 审核当前动作 |
| 审核 | `/reviews/logs` | 查询审核轨迹 | 刷新记录 |
| 权限 | `/settings/access` | 查看操作者身份和角色能力 | 刷新权限 |

## 兼容入口

- `/reviews/handoff` 永久转到 `/reviews/inbox`。
- `/automation/control` 和 `/automation/history` 永久转到 `/automation/runs`。
- 旧 `#section[:view]` 书签只由根页面解析并转到类型化清单中的生产 URL。
- `/integrations/wechat-work/flow|settings`、`/catalog/editor|preview`、`/sales/overview|actions` 和 `/settings/accounts` 暂时保留为迁移期子视图；后续功能分支应按验收矩阵决定合并或移除，不能将其当作新增业务的默认落点。

## 动态详情迁移

当前 `/conversations/[id]`、`/design/jobs/[id]`、`/sales/quotes/[id]`、`/sales/orders/[id]` 已有真实 App Router 页面并由通用详情 resolver 打开对应单一职责兼容视图，因此深链和刷新不再 404。对应 feature 分支负责把实体 ID 接入本域 controller，并替换兼容视图；路由路径、manifest ID 和页面职责不得改变。

后续若增加个人微信实例详情，应使用 `/integrations/personal-wechat/instances/[id]`，由个人微信 feature 分支实现，不能塞进控制面或安全页。

## 按钮合同

- 页面头最多一个主操作；文案描述结果，不能只写“处理”“确定”。
- 业务按钮使用稳定的 `data-action-id="<domain>.<entity>.<verb>"`。
- 跨域按钮只导航，不得在当前页偷偷执行目标域请求。
- 发送、付款、停用、取消、驳回和批量修改必须显示作用范围、操作者身份、后果与确认。
- 禁用状态必须显示原因或提供可访问说明；不确定投递、身份不一致、权限未知和配置缺失一律 fail-closed。
- 运行中只锁定当前实体或动作，禁止用一个全局 `busy` 锁死整个工作台。

## 功能分支边界

每个功能分支只拥有自己的 `features/<domain>`、对应 App Router 页面和模块测试。建议结构：

```text
features/<domain>/
  api.ts
  model.ts
  selectors.ts
  use-<domain>-controller.ts
  <domain>-feature-page.tsx
  components/
  <domain>.module.css
```

路由地基分支拥有 manifest、共享导航、路由状态和兼容入口。功能分支不得修改共享 manifest、导航、`globals.css` 或兼容层；需要新路由时先在集成分支确认职责。API 路径、请求语义和现有视觉 token 在本次拆分中保持不变。

## 上线合并顺序

1. 合入 router foundation，先保证所有生产 URL 可直接打开和刷新。
2. 各 feature 分支只替换本域薄页面的唯一 import，并完成本域 controller 清理。
3. 集成分支核对 `UI_ACCEPTANCE_MATRIX.md`，运行定向测试、TypeScript、Next 生产构建和 `git diff --check`。
4. 在 1440、1280、1024、760、390px 检查深链、刷新、前进后退、空态、错误态、权限态、键盘与核心操作。
5. 证明离开页面后，本域轮询、请求和事件监听已经停止，再移除该域旧兼容代码。
