# 02 平台线索承接实现说明

## 范围

本模块只做抖音、小红书等平台线索的本地人工承接，不做平台登录、抓取、私信读取或第三方 API 对接。

## 数据层

- 核心文件：`core/platform_leads.py`
- 默认数据文件：`data/platform_leads.json`
- 存储格式：JSON，包含 `version` 和 `leads`
- 核心字段：
  - `platform`
  - `nickname`
  - `source_url`
  - `source_note`
  - `need`
  - `wechat_id`
  - `phone`
  - `status`
  - `lead_score`
  - `quantity_estimate`
  - `budget`
  - `due_date`
  - `city`
  - `deal_value`
  - `owner`
  - `tags`
  - `notes`

## 能力

- `PlatformLeadStore.add_lead()`：新增人工录入的平台线索
- `PlatformLeadStore.bind_wechat()`：绑定微信号并更新状态
- `PlatformLeadStore.stats_by_platform()`：按平台统计总量、微信绑定数和状态分布
- `PlatformLeadStore.high_value_inputs()`：生成可传给 `core.high_value.evaluate_lead()` 的评分输入
- `build_platform_report()` / `render_platform_report()`：生成 Markdown 报表模型和内容

## CLI

入口文件：`scripts/platform_leads.py`

常用命令：

```bat
python scripts\platform_leads.py
python scripts\platform_leads.py --data data\platform_leads.json --output reports\platform_leads.md
```

bat 入口：

```bat
tools\reports\run_platform_leads.bat
```

当 `data/platform_leads.json` 不存在或没有真实线索时，CLI 会生成空状态说明和人工录入样例，不会写入伪造线索数据。
