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
- 侧栏以 `sales-center` 承载全部 `/sales/*` 页面，以 `automation-center` 承载四个 `/automation/*` 页面；`notice-center` 只归属 `/notifications`，提醒与自动化不再共用模块状态。
- 销售模块导航只展示报价与订单两个持续工作流。`/sales/actions` 保留为可深链的流程选择页，但通过 `showInModuleNav: false` 隐藏，避免第三个重复入口。

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
| 企业微信 | `/integrations/wechat-work/flow` | 核对回调、入站、路由和发送流程 | 检查接入流程 |
| 企业微信 | `/integrations/wechat-work/settings` | 只读核对本机配置、回调地址和身份策略 | 刷新配置检查 |
| 个人微信 | `/integrations/personal-wechat/instances` | 查看实例、端点、登录身份和实时状态 | 刷新实例状态 |
| 个人微信 | `/integrations/personal-wechat/instances/configure` | 校验并保存一个本机 RPA 实例 | 保存当前实例 |
| 个人微信 | `/integrations/personal-wechat/control` | 查看账号可用状态并导航到独立操作页 | 刷新账号状态 |
| 个人微信 | `/integrations/personal-wechat/window-inbound` | 采集真实微信窗口证据并查看快照 | 采集当前窗口 |
| 个人微信 | `/integrations/personal-wechat/inbound-drill` | 提交带完整身份的受控入站演练 | 提交入站演练 |
| 个人微信 | `/integrations/personal-wechat/safety` | 审阅阻断任务与不确定投递证据 | 刷新安全证据 |
| 设计 | `/design/settings` | 配置设计平台连接并检查健康、回调与就绪状态 | 保存配置 |
| 设计 | `/design/activation` | 生成设备 ID 并绑定后台激活码 | 激活设备 |
| 设计 | `/design/account` | 在设备激活后登录设计平台账号 | 登录账号 |
| 设计 | `/design/assets` | 上传、选择和预览客户素材 | 上传素材 |
| 设计 | `/design/jobs` | 查找并打开设计任务 | 查看任务详情 |
| 设计 | `/design/jobs/[id]` | 只读核对一条任务的身份、预算和候选图 | 选择后续操作 |
| 设计 | `/design/jobs/[id]/submit` | 预检并正式提交一条设计任务 | 确认正式提交 |
| 设计 | `/design/jobs/[id]/status` | 查询并更新一条任务的远端状态 | 同步远端状态 |
| 商品 | `/catalog/products` | 查找并打开商品，不执行写操作 | 查看商品详情 |
| 商品 | `/catalog/products/[skuCode]` | 只读核对一个 SKU 的价格、库存和状态 | 打开商品编辑 |
| 商品 | `/catalog/editor` | 新增或编辑单个 SKU 的业务字段 | 保存商品 |
| 商品 | `/catalog/repair` | 查看商品修复队列 | 打开修复任务 |
| 商品 | `/catalog/repair/[skuCode]` | 只修复一个 SKU 的库存、供应商或交期 | 确认提交修复 |
| 商品 | `/catalog/import` | 完成商品导入向导 | 确认入库 |
| 商品 | `/catalog/audit` | 查看商品库的自动化资格 | 刷新体检 |
| 商品 | `/catalog/bundles` | 验证预算和场景搭配 | 生成搭配建议 |
| 销售 | `/sales/actions` | 在报价与订单两个独立流程之间选择目标 | 打开目标流程 |
| 销售 | `/sales/quotes` | 查找并打开报价，不执行发送或建单 | 查看报价详情 |
| 销售 | `/sales/quotes/[id]` | 只读核对一条报价的金额、身份和状态 | 选择后续操作 |
| 销售 | `/sales/quotes/[id]/send` | 把一条已核对报价加入微信发送队列 | 确认报价入队 |
| 销售 | `/sales/quotes/[id]/create-order` | 只由一条报价创建订单草稿 | 确认创建订单 |
| 销售 | `/sales/orders` | 查找并打开订单，不执行编辑或跟进 | 查看订单详情 |
| 销售 | `/sales/orders/[id]` | 只读核对一条订单的金额、付款和状态 | 选择后续操作 |
| 销售 | `/sales/orders/[id]/edit` | 保存一条订单的字段 | 确认保存字段 |
| 销售 | `/sales/orders/[id]/messages/confirmation` | 只把订单确认消息加入发送队列 | 确认消息入队 |
| 销售 | `/sales/orders/[id]/messages/production` | 只把生产跟进消息加入发送队列 | 确认消息入队 |
| 销售 | `/sales/orders/[id]/messages/delivery` | 只把发货跟进消息加入发送队列 | 确认消息入队 |
| 自动化 | `/automation/runs` | 只查看当前状态、就绪结论和责任入口 | 刷新状态 |
| 自动化 | `/automation/control` | 经人工确认后启动、停止或执行一次自动化 | 执行一次 |
| 自动化 | `/automation/history` | 查看真实运行结果、耗时、阻断和错误 | 刷新记录 |
| 自动化 | `/automation/issues` | 处理自动化卡点 | 处理第一项 |
| 提醒 | `/notifications` | 阅读并定位业务提醒 | 全部已读 |
| Agent | `/agents` | 查看 Agent 及其适用范围 | 打开 Agent |
| Agent | `/agents/[id]` | 查看一个 Agent 的职责、训练覆盖和技能 | 返回 Agent 目录 |
| 训练 | `/training/import` | 导入对话训练材料 | 导入训练 |
| 训练 | `/training/import/history` | 查看聊天导入结果、解析数量和警告 | 刷新记录 |
| 训练 | `/training/review` | 筛选并定位待复核样本 | 打开样本详情 |
| 训练 | `/training/review/[id]` | 核对并复核地址指定的一条样本 | 提交当前复核 |
| 训练 | `/training/review/batch` | 对人工勾选的多条样本提交同一结论 | 提交所选复核 |
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
- 旧 `#section[:view]` 书签只由根页面解析并转到类型化清单中的生产 URL。
- `/catalog/preview` 转到 `/catalog/import`。
- `/sales/overview` 转到 `/sales/quotes`，`/settings/accounts` 转到 `/integrations/personal-wechat/instances`。
- 旧 `#quote-center[:view]` 和 `#notice-center:automation[:view]` 书签继续解析；新页面状态分别使用 `sales-center` 和 `automation-center`。
- 上述兼容路由在 manifest 中保留旧书签解析能力，但通过 `showInModuleNav: false` 从模块导航隐藏，避免出现多个入口负责同一件事。

## 动态详情迁移

会话、发送任务、设计任务、商品、报价、订单、训练样本、Agent 和审核对象均使用路径级实体 ID；不存在的 ID 显示明确未找到状态，不再静默选中列表第一项。个人微信实例写操作统一进入 `/integrations/personal-wechat/instances/configure?accountId=`，实例列表保持只读。

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
