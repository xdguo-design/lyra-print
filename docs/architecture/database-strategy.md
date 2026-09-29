# 数据库策略

## 1. 两类数据库必须分开

打印平台包含两种完全不同的数据库用途。

### 平台数据库

用于保存打印平台自己的元数据：

- 打印任务
- 打印尝试
- 数据快照
- 模板与版本
- 数据源连接配置
- 设备与代理
- 审计记录

开发和单机部署阶段默认使用 SQLite：

```text
jdbc:sqlite:./print-platform.db
```

平台业务代码通过 Repository 隔离存储实现，后续可以把平台库切换为 PostgreSQL，而不改变业务数据源连接模型。

### 业务数据源

业务数据源是打印平台去读取的外部数据库。它与平台自身存储无关。

首期数据库类型：

| 类型 | JDBC URL 前缀 | JDBC Driver |
|---|---|---|
| SQLite | jdbc:sqlite: | org.sqlite.JDBC |
| MySQL | jdbc:mysql: | com.mysql.cj.jdbc.Driver |
| PostgreSQL | jdbc:postgresql: | org.postgresql.Driver |
| SQL Server | jdbc:sqlserver: | com.microsoft.sqlserver.jdbc.SQLServerDriver |
| Oracle | jdbc:oracle: | oracle.jdbc.OracleDriver |

## 2. 凭据规则

数据库密码不直接保存在 SQLite 的 `data_source_connection` 表。

表内只保存：

- username
- secretRef
- jdbcUrl
- dbType
- readOnly
- enabled

当前连接测试 API 可以临时接收 password，但不会持久化。正式部署后，`secretRef` 对接环境变量、密钥服务或部署平台 Secret。

## 3. 只读原则

业务数据源默认 `readOnly=true`。

平台后续执行 SQL 时还需要继续增加：

- 只允许已发布 SQL 模板
- 拒绝 INSERT / UPDATE / DELETE / DDL
- 查询超时
- 最大行数
- 最大数据量
- 参数类型校验
- SQL 审计
- 数据库账号本身使用只读权限

`Connection#setReadOnly(true)` 只是额外保护，不替代数据库账号权限。

## 4. 当前 SQLite 表

```text
print_task
print_snapshot
print_attempt
data_source_connection
```

启动时使用 `db/schema.sql` 幂等初始化。

## 5. 下一步

- 数据源新增/编辑/停用页面
- secretRef 密钥解析器
- SQL 查询模板与版本
- SQL 安全解析与只读执行器
- 数据源连接池按 connectionId 隔离
- 连接健康检查与熔断
- 平台库 PostgreSQL profile
