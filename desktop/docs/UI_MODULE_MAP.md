# UI 模块与路由地图

本文档定义工作台路由地基的所有权。目标是让页面像积木一样独立组合：一个 URL 对应一个完整用户目标，页面只加载本域数据，跨域动作只负责导航。

## 路由地基

- `apps/web/src/app/route-manifest.ts` 是唯一的类型化路由清单，记录页面标题、唯一职责、主操作、工作台模块和旧书签。
- `apps/web/src/app/**/page.tsx` 只能直接组合一个归属明确的 `features/<domain>` 页面，或做一个明确的兼容重定向；不得承载业务状态、请求或样式。
- `apps/web/src/app/feature-route-shell.tsx` 只提供共享工作台薄壳。它不包含 feature 注册表，不保存业务状态，也不调用业务接口，因此页面不会把其他模块打进同一个客户端包。
- `apps/web/src/app/legacy-workbench.tsx` 已退出运行链路，仅作为未引用的迁移档案保留。任何新功能都不得继续加入该文件。
- 新路由只加载 `workbench-tokens.css`、小型 `styles/base.css` 和组件 CSS Modules；31,000 行旧 `globals.css` 已从根布局解除引用。
- 侧栏和模块内导航使用真实 `Link`，跨域动作使用 `router.push`。旧根页面哈希只在 `/` 转换一次，因此深链、刷新、前进和后退都由 URL 驱动。
- `loading.tsx`、`error.tsx`、`not-found.tsx` 与 `route-state.tsx` 提供路由级状态。业务 feature 仍需独立实现权限态和本域空态。
- `tools/check-modular-ui-bundles.js` 读取 Next 客户端引用清单，阻止一个路由引用多个业务域、旧工作台或超过阈值的客户端脚本。

## 生产页面责任

| 域 | 页面 | 唯一职责 | 主操作 |
| --- | --- | --- | --- |
| 总览 | `/overview` | 查看全局经营、通道、发送与自动化状态 | 刷新总览 |
| 会话 | `/conversations` | 筛选并选择客户会话 | 打开会话 |
| 会话 | `/conversations/[id]` | 阅读一条会话并提交人工回复 | 人工回复入队 |
| 会话 | `/conversations/[id]/context` | 只读查看客户、任务和发送身份 | 查看上下文 |
| 会话 | `/conversations/[id]/assignment` | 修改负责人、优先级、状态和 SLA | 保存分配 |
| 路由 | `/routing` | 只读评估消息路由 | 评估路由 |
| 路由 | `/routing/process` | 写入一条消息并执行路由计划 | 确认处理 |
| 发送 | `/send/queue` | 选择安全发送任务或处理整个安全队列 | 打开任务 |
| 发送 | `/send/queue/[id]` | 核对并执行一项安全发送任务 | 执行当前任务 |
| 发送 | `/send/blocked` | 选择阻塞或失败任务 | 打开任务 |
| 发送 | `/send/blocked/[id]` | 判断一项任务应重排还是取消 | 提交判断 |
| 发送 | `/send/diagnostics` | 只读诊断适配器、窗口和回执 | 刷新诊断 |
| 发送 | `/send/diagnostics/operations` | 运行桥接回执与发送异常扫描 | 扫描异常 |
| 接入 | `/integrations/channels` | 查看所有通道状态并导航到配置或验收页 | 刷新通道 |
| 企业微信 | `/integrations/wechat-work` | 做本地配置检查和只读上线预检 | 运行只读预检 |
| 个人微信 | `/integrations/personal-wechat/instances` | 管理 RPA 实例、端点与账号绑定 | 保存实例 |
| 个人微信 | `/integrations/personal-wechat/control` | 查看账号状态、待处理发送与人工接管边界 | 刷新账号控制面 |
| 个人微信 | `/integrations/personal-wechat/window-inbound` | 验证真实窗口证据与带身份的受控入站 | 采集当前窗口 |
| 个人微信 | `/integrations/personal-wechat/safety` | 查看同意、频控、敏感内容和审计 | 全局停止 |
| 设计 | `/design/settings` | 配置设计平台连接并检查健康、回调与就绪状态 | 保存配置 |
| 设计 | `/design/activation` | 生成设备 ID 并绑定后台激活码 | 激活设备 |
| 设计 | `/design/account` | 在设备激活后登录设计平台账号 | 登录账号 |
| 设计 | `/design/assets` | 上传、选择和预览客户素材 | 上传素材 |
| 设计 | `/design/jobs` | 筛选和创建设计任务 | 新建设计任务 |
| 设计 | `/design/jobs/[id]` | 完成一条设计任务的预检、提交、轮询、选图或取消 | 提交当前任务 |
| 商品 | `/catalog/products` | 管理商品资料 | 新增商品 |
| 商品 | `/catalog/repair` | 修复资料和图片问题 | 保存当前修复 |
| 商品 | `/catalog/import` | 完成商品导入向导 | 确认入库 |
| 商品 | `/catalog/audit` | 查看商品库的自动化资格 | 刷新体检 |
| 商品 | `/catalog/bundles` | 验证预算和场景搭配 | 生成搭配建议 |
| 销售 | `/sales/actions` | 在报价与订单两个独立流程之间选择目标 | 打开目标流程 |
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
| 审核 | `/reviews/design` | 选择待审核设计 | 打开审核对象 |
| 审核 | `/reviews/design/[id]` | 提交一项设计审核决策 | 提交设计决策 |
| 审核 | `/reviews/quotes` | 选择待审核报价 | 打开审核对象 |
| 审核 | `/reviews/quotes/[id]` | 提交一项报价审核决策 | 提交报价决策 |
| 审核 | `/reviews/orders` | 选择待审核订单 | 打开审核对象 |
| 审核 | `/reviews/orders/[id]` | 提交一项订单审核决策 | 提交订单决策 |
| 审核 | `/reviews/logs` | 查询审核轨迹 | 刷新记录 |
| 权限 | `/settings/access` | 查看操作者身份和角色能力 | 刷新权限 |

## 兼容入口

- `/reviews/handoff` 永久转到 `/reviews/inbox`。
- `/automation/control` 和 `/automation/history` 永久转到 `/automation/runs`。
- 旧 `#section[:view]` 书签只由根页面解析并转到类型化清单中的生产 URL。
- `/integrations/wechat-work/flow|settings` 转到 `/integrations/wechat-work`。
- `/catalog/editor` 转到 `/catalog/products`，`/catalog/preview` 转到 `/catalog/import`。
- `/sales/overview` 转到 `/sales/quotes`，`/settings/accounts` 转到 `/integrations/personal-wechat/instances`。
- 上述兼容路由在 manifest 中保留旧书签解析能力，但通过 `showInModuleNav: false` 从模块导航隐藏，避免出现多个入口负责同一件事。

## 动态详情迁移

会话、发送任务、设计任务、销售对象和审核对象均使用路径级实体 ID；不存在的 ID 显示明确未找到状态，不再静默选中列表第一项。个人微信实例继续通过 `/integrations/personal-wechat/instances?accountId=` 把查询选择传到所属页面。

后续若增加个人微信实例详情，应使用 `/integrations/personal-wechat/instances/[id]`，由个人微信 feature 分支实现，不能塞进控制面或安全页。

## 按钮合同

- 页面头最多一个主操作；文案描述结果，不能只写“处理”“确定”。
- 业务按钮使用稳定的 `data-action-id="<domain>.<entity>.<verb>"`。
- 跨域按钮只导航，不得在当前页偷偷执行目标域请求。
- 发送、付款、停用、取消、驳回和批量修改必须显示作用范围、操作者身份、后果与确认。
- 禁用状态必须显示原因或提供可访问说明；不确定投递、身份不一致、权限未知和配置缺失一律 fail-closed。
- 运行中只锁定当前实体或动作，禁止用一个全局 `busy` 锁死整个工作台。

## 功能分支边界

每个功能分支只拥有自己的 `features/<domain>` 和模块测试；最终集成分支统一维护薄 App Router 页面与 `feature-route-shell.tsx`。每个 `page.tsx` 必须直接导入且只导入一个 feature。建议结构：

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

路由地基分支拥有 manifest、共享导航、路由状态和兼容入口。功能分支不得修改共享 manifest、导航、旧 `globals.css` 或迁移档案；需要新路由时先在集成分支确认职责。API 路径、请求语义和现有视觉 token 在本次拆分中保持不变。

## 上线合并顺序

1. router foundation 提供真实 URL、共享壳和兼容重定向。
2. conversations/routing、integrations/send、design/catalog/sales、automation/governance 分支分别交付独立 feature。
3. 集成分支让每个 App Router 页面直接组合一个 feature，并通过客户端引用清单证明路由包彼此隔离。
4. 核对 `UI_ACCEPTANCE_MATRIX.md`，运行定向测试、TypeScript、Next 生产构建、模块包隔离检查和 `git diff --check`。
5. 在 1440、1280、1024、760、390px 检查深链、刷新、前进后退、空态、错误态、权限态、键盘与核心操作，并证明页面切换后本域副作用停止。
