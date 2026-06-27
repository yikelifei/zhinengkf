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
