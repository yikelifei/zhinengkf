# 设计平台联动接口契约

客服平台主要调用设计平台。前期本机调用，后期公网 HTTPS 调用。

## 认证

所有客服平台调用设计平台的请求都带：

```http
Authorization: Bearer <DESIGN_PLATFORM_API_KEY>
```

设计平台回调客服平台时带：

```http
Authorization: Bearer <DESIGN_PLATFORM_CALLBACK_API_KEY>
```

## 设计平台需要提供

### 健康检查

```http
GET /v1/health
```

返回：

```json
{
  "ok": true,
  "service": "design-platform"
}
```

### 上传素材

```http
POST /v1/assets/upload
```

请求：

```json
{
  "assetId": "客服平台素材ID",
  "fileName": "customer-logo.png",
  "mimeType": "image/png",
  "localPath": "C:\\storage\\assets\\customer-logo.png",
  "sizeBytes": 1024,
  "role": "customer_logo",
  "ownerType": "customer",
  "ownerId": "customer-001",
  "source": "customer_upload",
  "sourceRef": "wechat-message-001",
  "skuCode": "SKU-001",
  "name": "客户Logo"
}
```

返回：

```json
{
  "assetId": "design-asset-001",
  "remoteAssetId": "design-asset-001",
  "url": "http://127.0.0.1:3700/assets/design-asset-001/customer-logo.png",
  "fileName": "customer-logo.png",
  "mimeType": "image/png",
  "role": "customer_logo"
}
```

客服平台会把返回的 `remoteAssetId` 和 `url` 放入创建设计任务的 `assets`，设计平台必须用这些素材作为真实 SKU 图、客户 Logo 或参考图来源。

#### 客服平台本地资产摄取边界

- base64、UTF-8 文本和 HTTP(S) URL 下载统一复用图片指纹的最大字节数；当前为 20 MiB，边界值允许，超限在生成本地路径前返回 `400 Bad Request`。
- base64 必须使用规范字符和 padding；`data:` URL 只接受以 `;base64,` 承载的形式，普通 percent-encoded `data:` 内容不落盘。
- URL 只接受无 credentials 的 `http:` 或 `https:`。每一跳（最多 5 次重定向）都重新解析并要求全部 DNS 结果为公网地址；loopback、私网、link-local、保留、文档和组播 IPv4/IPv6 均在发请求前拒绝。
- 实际 HTTP(S) Agent 的 lookup 只返回本跳已经验证的地址，并禁用环境代理与 Axios 自动跳转，避免 DNS rebinding 或由代理重新解析。设计平台凭据按每一跳重新计算，只会发送到配置的设计平台 origin；跳到 CDN 或其他 origin 时不携带。
- 下载继续复用 `DESIGN_PLATFORM_TIMEOUT_MS`、`maxContentLength`、`maxBodyLength`，并在完整响应后按真实字节数二次校验。所有网络测试注入 DNS 与请求实现，不访问真实网络。
- 保存前以 magic 和实际解码内容确定类型，不信任调用方的 `fileName`、`mimeType` 或 URL 扩展名。支持的 raster 为 PNG/JPEG/WebP/GIF/BMP，另支持受限 PDF 与 UTF-8 `.txt`；扩展名或声明 MIME 冲突、SVG/HTML/XML/脚本载荷、损坏图片、主动 PDF 标记都会在落盘前拒绝。
- PDF 即使通过基础结构与主动标记检查也不视为安全内联内容，只能以 attachment 下载。两处 `local-file` 响应统一带 `X-Content-Type-Options: nosniff`、sandbox CSP 和安全 `Content-Disposition`；读取时 realpath 后再次验证 storage 边界，拒绝 symlink/junction 逃逸。
- 任何格式错误、超限或安全校验失败都不得留下资产文件。上述 SSRF 与内容边界由仓库实现和完成度审计直接验证，不再作为“部署侧未决”项冒充已完成。

### 创建设计任务

```http
POST /v1/design-jobs
```

请求：

```json
{
  "requestId": "客服平台唯一ID",
  "wechatAccountId": "微信账号ID",
  "customerId": "客户ID",
  "conversationId": "会话ID",
  "orderId": "订单草稿ID",
  "budget": {
    "mode": "per_box",
    "perUnitAmount": 200,
    "quantity": 100,
    "totalAmount": 20000
  },
  "scene": "员工福利",
  "bundle": {
    "giftBox": {
      "skuCode": "BOX-A",
      "name": "红金礼盒A",
      "salePrice": 60,
      "dimensions": {
        "width": 320,
        "height": 90,
        "depth": 240
      },
      "images": []
    },
    "items": []
  },
  "assets": [],
  "outputCount": 6,
  "renderStyle": "真实产品摆拍",
  "requirements": {
    "useRealSkuImages": true,
    "showAllItems": true,
    "noWatermark": true,
    "highResolution": true
  },
  "callback": {
    "url": "http://127.0.0.1:3200/api/integrations/design-platform/callback",
    "method": "POST",
    "events": ["completed", "failed"],
    "headers": {
      "Authorization": "Bearer <DESIGN_PLATFORM_CALLBACK_API_KEY>"
    },
    "requestId": "客服平台任务 requestId",
    "fallbackPolling": true
  }
}
```

返回：

```json
{
  "externalJobId": "design-job-001",
  "status": "generating"
}
```

### 查询任务

```http
GET /v1/design-jobs/:externalJobId
```

返回：

```json
{
  "externalJobId": "design-job-001",
  "status": "generating"
}
```

### 查询结果

```http
GET /v1/design-jobs/:externalJobId/results
```

返回：

```json
{
  "externalJobId": "design-job-001",
  "status": "completed",
  "images": [
    {
      "imageId": "1",
      "downloadUrl": "http://127.0.0.1:3700/files/design-job-001/1.png",
      "width": 1024,
      "height": 1024
    }
  ]
}
```

### 取消任务

```http
POST /v1/design-jobs/:externalJobId/cancel
```

返回：

```json
{
  "ok": true,
  "status": "cancelled"
}
```

## 设计平台回调客服平台

```http
POST /api/integrations/design-platform/callback
```

请求：

```json
{
  "requestId": "客服平台唯一ID",
  "externalJobId": "design-job-001",
  "status": "completed",
  "images": [
    {
      "imageId": "1",
      "downloadUrl": "http://127.0.0.1:3700/files/design-job-001/1.png",
      "width": 1024,
      "height": 1024
    }
  ],
  "errorMessage": ""
}
```

客服平台收到后会：

- 下载候选图。
- 保存到 `storage/design-jobs/<jobId>/`。
- 绑定客户、会话、微信账号和订单草稿。
- 高价值客户进入人工审核。
- 低预算客户进入快速确认。
