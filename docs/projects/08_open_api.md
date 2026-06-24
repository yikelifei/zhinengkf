# 本地 API 和外部软件集成

- 模块 ID: `08_open_api`
- 分类: `integration`
- 状态: `partial`

## 目标

为 Web 控制台、出图软件和后续平台服务提供稳定 API。

## 输入

- HTTP 请求
- API Key
- 业务参数

## 输出

- JSON 响应
- 审计日志
- 报表文件

## 独立运行

- `tools\quality\run_web_console_smoke.bat`

## 独立检查

- `tools\quality\run_health_check.bat`
- `tools\quality\run_web_console_smoke.bat`

## 验收标准

- 核心 API 能返回稳定 JSON。
- 接口异常不导致服务崩溃。
- 后续必须加鉴权、限流和日志。

## 下一步

- 新增 API Key 鉴权。
- 新增出图任务 API。
