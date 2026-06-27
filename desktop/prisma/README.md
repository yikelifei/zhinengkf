# Prisma 数据模型说明

第一版 datasource 固定为 PostgreSQL：

```prisma
provider = "postgresql"
```

原因是 Prisma 的 datasource provider 需要静态声明。为了后续迁移 MySQL，当前模型避免使用 PostgreSQL 独占的数组字段，标签、图片、搭配规则、需求快照都用 `Json` 保存。

切换 MySQL 时需要：

1. 把 `provider` 改成 `mysql`。
2. 把 `DATABASE_URL` 改成 MySQL 连接串。
3. 运行迁移验证。
