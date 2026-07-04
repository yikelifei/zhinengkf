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
