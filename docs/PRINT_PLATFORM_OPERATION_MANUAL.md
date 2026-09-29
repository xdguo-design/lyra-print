# 打印平台操作手册

版本：v0.5  
适用范围：Print Platform Backend / Web Console / Print Agent / Windows Spooler  
更新时间：2026-09-22

## 1. 系统入口

打印平台用于统一管理模板、数据源、正式打印任务、PDF/RAW 打印、打印机、Windows Spooler Job、运营报表和系统日志。

控制台主要菜单：

- 平台概览
- 模板中心
- 数据源
- 打印任务
- 系统日志
- 运营报表

## 2. 正式打印任务

正式打印任务创建后会冻结 Snapshot。重试继续使用原 Snapshot，不重新查询业务数据，也不重新生成 RAW 字节。

任务主状态：

```text
CREATED
  -> QUEUED
  -> PRINTING
      -> SUCCESS
      -> FAILED
      -> CANCELLED
      -> WAITING_AGENT
FAILED -> RETRYING -> QUEUED
```

### 2.1 模板打印

在“打印任务”中选择已发布模板、业务数据和打印机后创建正式任务。

### 2.2 PDF 打印

PDF 会直接冻结到 PrintTask Snapshot。重试使用同一 PDF 内容。

### 2.3 RAW 打印

支持：

- ESC/POS
- ZPL
- TSPL
- CPCL

RAW 任务冻结的是最终字节流，平台保存：

- `rawLanguage`
- `rawBase64`
- `byteLength`
- `sha256`

RAW 任务份数固定为 1。需要多份时应由设备协议自身编码，避免平台改变 byte-exact Snapshot。

## 3. Windows Spooler Job

RAW 任务提交到 Windows 后，Agent 通过 `StartDocPrinter` 直接取得真实 Job ID，并形成：

```text
PrintTask
  -> PrintAttempt
      -> agentJobId
      -> spoolerJobId
      -> printerId
```

任务详情可以查看：

- Windows Job ID
- Spooler 状态
- Windows 文档名
- 绑定时间
- 最后同步时间

### 3.1 暂停

任务详情中点击“暂停”，控制绑定的同一个 Windows Job。

### 3.2 恢复

暂停状态下点击“恢复”。

### 3.3 取消

点击“取消 Job”会取消绑定的 Windows Job，并同步平台状态。

> Windows Spooler 的 COMPLETED 表示队列处理完成，不等同于已经确认物理出纸。物理完成确认仍需打印机反馈、SNMP 或厂商协议。

## 4. 系统日志

进入“系统日志”菜单可以查看 Backend、PrintTask、Attempt、Agent、Printer 和 Windows Spooler 的统一运行日志。

### 4.1 顶部指标

页面显示：

- 全部日志
- 待处理 ERROR/FATAL
- 最近 24 小时 ERROR/FATAL
- 当前筛选结果数量

### 4.2 查询条件

支持按以下条件筛选：

- 日志等级：DEBUG / INFO / WARN / ERROR / FATAL
- 模块
- 事件类型
- PrintTask ID
- Attempt ID
- Agent ID
- Printer ID
- Windows Spooler Job ID
- 已处理 / 待处理
- 关键词
- 开始时间 / 结束时间

### 4.3 常见事件

打印任务：

```text
TASK_CREATED
TASK_QUEUED
TASK_STARTED
TASK_SUCCESS
TASK_FAILED
TASK_WAITING_AGENT
TASK_CANCELLED
TASK_RETRYING
ATTEMPT_CREATED
```

Windows Spooler：

```text
SPOOLER_BIND
SPOOLER_STATUS_CHANGED
SPOOLER_UNKNOWN
```

系统异常：

```text
UNHANDLED_EXCEPTION
SYSTEM_LOG_CLEANUP_COMPLETED
SYSTEM_LOG_CLEANUP_FAILED
```

### 4.4 错误详情

点击“详情”可以查看：

- message
- stack trace
- requestId
- taskId
- attemptId
- agentId / agentInstanceId
- printerId
- spoolerJobId
- hostName
- IP
- 创建时间
- 更新时间
- resolved / resolvedAt

通过这些字段可以从一个错误直接追到具体 PrintTask、打印尝试、Agent、打印机和 Windows Job。

### 4.5 标记已处理

ADMIN 可以将 ERROR/FATAL 标记为“已处理”。

未解决 ERROR/FATAL 默认不会被自动清理。

## 5. 系统日志定时清理

系统默认启用定时清理。

默认策略：

| 等级 | 默认保留时间 |
| --- | ---: |
| DEBUG | 7 天 |
| INFO | 30 天 |
| WARN | 90 天 |
| ERROR | 180 天 |
| FATAL | 365 天 |

额外保护：

- 未解决的 ERROR/FATAL 不自动删除。
- 关联活跃 PrintTask 的日志不自动删除。
- 删除使用分批方式，默认每批 1000 条。
- 单次任务默认最多执行 100 批，避免长时间占用 SQLite 写锁。

默认定时任务：

```text
02:30 UTC
```

可通过环境变量调整：

```text
PRINT_SYSTEM_LOG_CLEANUP_ENABLED
PRINT_SYSTEM_LOG_CLEANUP_CRON
PRINT_SYSTEM_LOG_CLEANUP_ZONE
PRINT_SYSTEM_LOG_CLEANUP_BATCH_SIZE
PRINT_SYSTEM_LOG_CLEANUP_MAX_BATCHES
PRINT_SYSTEM_LOG_PRESERVE_UNRESOLVED_ERRORS

PRINT_SYSTEM_LOG_DEBUG_DAYS
PRINT_SYSTEM_LOG_INFO_DAYS
PRINT_SYSTEM_LOG_WARN_DAYS
PRINT_SYSTEM_LOG_ERROR_DAYS
PRINT_SYSTEM_LOG_FATAL_DAYS
```

ADMIN 也可以在“系统日志”页面点击“立即清理”手动执行一次保留策略。

## 6. Agent 与打印机检查

Agent 健康检查：

```http
GET /health
```

重点字段：

- `status=UP`
- `productionReady=true`
- `spoolerMonitoring=true`
- `spoolerControl=true`

Windows 本机可使用：

```powershell
Get-Printer
Get-PrintJob -PrinterName "<printer-name>"
```

## 7. 常见故障排查

### 7.1 RAW_PRINT / WritePrinter 失败

依次检查：

1. 系统日志中的 taskId。
2. Attempt 是否已经创建。
3. printerId 是否正确。
4. Agent 是否在线。
5. Windows 打印机是否 ONLINE。
6. spoolerJobId 是否已经绑定。
7. stack trace 中的 Win32 / PowerShell 错误信息。

### 7.2 SPOOLER_UNKNOWN

表示平台当前无法确认 Windows Job 状态，不能直接当成 SUCCESS 或 FAILED。

检查：

- Agent 是否在线。
- Windows Spooler 是否运行。
- Job 是否已被系统清理。
- taskId 与 spoolerJobId 是否仍一致。

### 7.3 WAITING_AGENT

表示正式任务等待本地 Agent 恢复。Agent 恢复后应先核对实际出纸情况，再决定恢复、失败或重试，避免重复打印。

### 7.4 任务显示 SUCCESS 但没有出纸

SUCCESS / Spooler COMPLETED 不能单独证明物理出纸。对于票据、处方、标签等需要严格确认的场景，应增加设备反馈能力。

## 8. 权限

当前日志相关权限：

| 操作 | 最低权限 |
| --- | --- |
| 查询系统日志 | VIEW |
| 查看日志详情 | VIEW |
| Agent 批量上报日志 | OPERATE |
| 标记日志已处理 | ADMIN |
| 手工清理日志 | ADMIN |

## 9. 发布验收

发布前至少确认：

- [ ] Backend Maven 全量测试通过
- [ ] Frontend unit test 通过
- [ ] Frontend build 通过
- [ ] OpenAPI contract 通过
- [ ] SDK + Agent build/smoke 通过
- [ ] Print smoke 通过
- [ ] Offline acceptance bundle 通过
- [ ] RAW Snapshot SHA-256 一致性通过
- [ ] Spooler Job 精确绑定通过
- [ ] Pause / Resume / Cancel 通过
- [ ] SystemLog 查询与关联通过
- [ ] 未处理错误清理保护通过
- [ ] 活跃任务日志清理保护通过

## 10. 当前重要 API

```text
GET  /api/system-logs
GET  /api/system-logs/{id}
POST /api/system-logs/batch
POST /api/system-logs/{id}/resolve
POST /api/system-logs/cleanup
```

打印任务相关 API 详见：

```text
contracts/openapi/print-platform.yaml
```


## 11. Agent 心跳与离线检测

Print Agent 可以主动向平台上报运行状态。只有配置平台地址后才启用心跳，不配置时不影响现有本地打印能力。

推荐环境变量：

```text
PRINT_PLATFORM_URL=http://print-platform-host:8080
PRINT_PLATFORM_API_KEY=<operator-api-key>

PRINT_AGENT_ID=print-agent-site-a
PRINT_AGENT_INSTANCE_ID=PRINT-PC-01
PRINT_AGENT_VERSION=0.1.0
PRINT_AGENT_HEARTBEAT_SECONDS=30
```

Agent 每次心跳会上报：

- Agent ID / Instance ID
- 主机名与操作系统
- Agent 版本
- CPU 使用率
- 内存使用率
- 活跃任务数
- 排队任务数
- 打印机数量
- Windows Spooler 服务状态

平台默认状态判定：

| 最近心跳距离当前时间 | Agent 状态 |
| --- | --- |
| <= 90 秒 | ONLINE |
| 90 秒 ~ 300 秒 | UNKNOWN |
| > 300 秒 | OFFLINE |

可通过以下环境变量修改：

```text
PRINT_AGENT_UNKNOWN_AFTER_SECONDS
PRINT_AGENT_OFFLINE_AFTER_SECONDS
PRINT_AGENT_HEARTBEAT_RETENTION_DAYS
```

心跳历史默认保留 7 天。

当 Agent 从 ONLINE 变成 UNKNOWN/OFFLINE，平台会写入 `AGENT_STATUS_CHANGED` 系统日志。

当 Agent 进入 OFFLINE，会触发 `AGENT_OFFLINE` 告警；新心跳恢复后，该告警自动变为 RESOLVED。

## 12. 告警中心

控制台“告警中心”用于查看和处理生产运行告警。

当前内置规则：

| 规则 | 默认条件 |
| --- | --- |
| AGENT_OFFLINE | Agent 超过 300 秒没有心跳 |
| SPOOLER_STUCK | SPOOLING/PRINTING 超过 600 秒 |
| PRINTER_FAILURE_BURST | 同一打印机 300 秒内失败 >= 10 次 |

告警状态：

```text
OPEN
  -> ACKED
  -> RESOLVED
```

也可能由监控条件恢复自动：

```text
OPEN/ACKED
  -> RESOLVED
```

同一规则、同一资源只保留一条活跃告警。监控任务再次发现同一问题时只更新 `lastSeenAt`，不会不断创建重复告警。

权限：

| 操作 | 最低权限 |
| --- | --- |
| 查看 Agent | VIEW |
| 查看告警 | VIEW |
| 查看告警规则 | VIEW |
| Agent 心跳上报 | OPERATOR |
| ACK 告警 | OPERATOR |
| 人工关闭告警 | ADMIN |
| 启停告警规则 | ADMIN |

### Agent 管理页

可以查看：

- ONLINE / UNKNOWN / OFFLINE 数量
- Agent / Instance
- 主机和 IP
- 系统与版本
- CPU / 内存
- 活跃和排队任务
- 打印机数量
- Spooler 状态
- 最近心跳时间
- 最近心跳历史

### 告警中心页

可以查看：

- OPEN / ACKED / RESOLVED 数量
- 告警规则状态
- 告警级别
- 资源类型
- PrintTask / Attempt
- Agent
- Printer
- Windows Spooler Job
- 首次出现和最近出现时间

## 13. Agent 心跳部署检查

Agent 主机完成配置后，检查：

1. Agent 启动日志包含 `agent heartbeat enabled`。
2. 控制台“Agent 管理”出现对应实例。
3. Agent 状态为 ONLINE。
4. Windows 主机上 Spooler 为 RUNNING。
5. 停止 Agent 超过离线阈值后，告警中心出现 AGENT_OFFLINE。
6. 重启 Agent 后，状态恢复 ONLINE，离线告警自动 RESOLVED。

> 如果平台启用了 API Key RBAC，`PRINT_PLATFORM_API_KEY` 应使用至少 OPERATOR 权限的 Key。
