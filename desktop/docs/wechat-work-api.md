# Enterprise WeChat API setup

This project exposes the Enterprise WeChat callback at:

```text
GET/POST {CUSTOMER_SERVICE_PUBLIC_BASE_URL}/api/wechat-work/callback
```

Local status check:

```text
GET http://127.0.0.1:3200/api/wechat-work/status
```

## Required environment variables

Put these in `desktop/.env` or the runtime environment that starts the desktop API:

```text
CUSTOMER_SERVICE_PUBLIC_BASE_URL=https://your-public-domain.example.com
WECHAT_WORK_CORP_ID=your-corp-id
WECHAT_WORK_AGENT_ID=your-agent-id
WECHAT_WORK_SECRET=your-app-or-customer-service-secret
WECHAT_WORK_TOKEN=the-token-you-set-in-wechat-work-admin
WECHAT_WORK_ENCODING_AES_KEY=the-43-character-encoding-aes-key
WECHAT_WORK_OPEN_KFID=your-open-kfid
WECHAT_WORK_DEFAULT_WECHAT_ACCOUNT_ID=wechat_demo_1
WECHAT_WORK_DEFAULT_CONVERSATION_ID=conv_demo_1
WECHAT_WORK_DEFAULT_CUSTOMER_ID=customer_demo_1
```

`CUSTOMER_SERVICE_PUBLIC_BASE_URL` must be a public HTTPS address that Enterprise WeChat can reach. If you are testing on this PC, use a tunnel and point it to port `3200`.

The first version routes all incoming Enterprise WeChat customer-service text messages into `WECHAT_WORK_DEFAULT_CONVERSATION_ID`. After the callback is verified, the next step is mapping `external_userid` to real local customers and conversations.

## Enterprise WeChat admin fields

Use these values in the Enterprise WeChat callback page:

```text
URL:   {CUSTOMER_SERVICE_PUBLIC_BASE_URL}/api/wechat-work/callback
Token: WECHAT_WORK_TOKEN
EncodingAESKey: WECHAT_WORK_ENCODING_AES_KEY
```

After saving the callback in Enterprise WeChat, call `/api/wechat-work/status`. All required items should show `true`.
