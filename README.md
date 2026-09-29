# 独立打印平台

面向多个业务系统的通用文档打印平台。

当前优先建设范围：**平台基础 + 模板中心 + 可视化模板设计器**。  
平台自身数据默认使用 SQLite；业务数据库连接与平台库解耦。

## 当前状态

当前分支已经包含可运行的正式工程，而不是 HTML 原型：

- Vue 3 + TypeScript + Ant Design Vue 管理控制台
- Python 3.11+ + FastAPI 后端
- SQLite 平台数据库
- 模板中心与版本发布
- 可视化模板设计器
- 高级动态表格
- 多页打印预览
- 浏览器打印 / 保存 PDF
- 真实二维码与条码生成
- 图片上传
- 照片四角校正 / 透视矫正 / 叠加对比
- 可选外部 AI 版式识别 Provider
- 灰度发布、回滚与审计
- 打印任务状态机
- 运营报表（任务/设备/模板统计、按日趋势、CSV 导出）
- 多数据库连接配置与测试
- TypeScript 业务接入 SDK
- 可嵌入业务系统页面的浏览器预览渲染包（不依赖 print-console / Print Agent）
- 本地 Print Agent（mock + 可配置 production command adapter）
- Chromium 浏览器扩展桥
- OpenAPI 3.1
- GitHub Actions CI

## 身份认证与 RBAC

默认开发模式不启用鉴权；生产环境可以启用后端 API Key RBAC：

```bash
PRINT_SECURITY_ENABLED=true
PRINT_SECURITY_ADMIN_KEY=<admin-key>
PRINT_SECURITY_DESIGNER_KEY=<designer-key>
PRINT_SECURITY_OPERATOR_KEY=<operator-key>
PRINT_SECURITY_VIEWER_KEY=<viewer-key>
```

角色：

- `VIEWER`：读取模板、任务和报表。
- `DESIGNER`：VIEWER + 模板设计、测试、审核与发布。
- `OPERATOR`：VIEWER + 正式打印任务创建与状态操作。
- `ADMIN`：全部权限，包括打印机、数据源、在线模板安装/发布等管理动作。

控制台在启用鉴权后会要求输入 API Key，并通过 `Authorization: Bearer` 调用后端。生产环境仍应使用 HTTPS / 反向代理并定期轮换 Key；这一层是当前独立部署版的访问控制，未来 SaaS 账号体系可以替换为正式用户/租户身份而不改变业务权限边界。

## 模板中心

模板状态：

```text
DRAFT → TESTING → REVIEWING → PUBLISHED
                              ↓
                           DISABLED
```

支持：

- 模板列表
- 新建
- 复制
- 草稿修订
- 测试状态
- 提交审核
- 发布前校验
- 不可变发布版本
- 版本历史
- 灰度生效范围
  - ALL
  - ORG
  - CAMPUS
  - DEPARTMENT
  - TERMINAL
- 回滚到历史版本
- 回滚生成新的发布版本，不覆盖历史版本
- 模板审计记录
- 停用模板
- 本地 SQLite / 在线模板目录分层
- 已发布版本上传在线模板库
- 在线模板中心：分类、搜索、缩略图、FREE / PRO、在线预览、安装 / 升级
- 12 张 Print Platform Original 原创商用模板开箱可浏览
- 在线模板按 FREE / SUBSCRIPTION 安装与升级
- 订阅模板 Entitlement 授权校验与本地授权缓存

SQLite 表：

```text
print_template
print_template_version
print_template_release
print_template_audit
print_template_ai_task
```

## 本地模板与在线模板

模板中心分为两种存储位置：

- **本地模板**：保存在平台 SQLite 中，负责草稿、测试、审核、发布、回滚和审计，是模板编辑的唯一来源。
- **在线模板**：保存官方发布的不可变模板包，用于模板市场分发。客户端执行“安装 / 升级”，不会把订阅模板转换成普通本地草稿。

在线模板中心 v1 自带 **12 张 Print Platform Original 原创商用模板**，不配置外部数据库也可以直接浏览、搜索、分类筛选、在线预览，并安装 FREE 模板。当前官方目录包括 7 张 FREE 与 5 张 PRO，覆盖财务、销售、采购、仓储、零售、医疗和物流。

外部模板目录仍然可以选配 **Neon Serverless Postgres**。当前 Python 后端保留在线模板扩展契约；未配置外部适配器时会 fail closed，不影响本地模板、预览和打印。外部 PostgreSQL/Neon 目录应通过独立 Python adapter 接入，不把数据库凭据暴露给前端。

在线模板遵循以下规则：

- 只有本地状态为 `PUBLISHED` 的模板可以上传。
- 上传的是当前不可变发布版本，不上传本地草稿。
- 同一个 `templateCode + versionNo` 重复上传是幂等更新。
- 官方精选目录与外部在线目录统一展示；外部目录默认展示每个模板编码的最新上传版本，历史版本仍可按版本号读取。
- 在线模板分为 `FREE` 与 `SUBSCRIPTION`；订阅模板安装前必须通过 Entitlement。
- 安装后的在线模板由 `template_installation` 记录来源、云版本与授权状态，不作为普通本地模板绕过订阅。
- `ACTIVE / GRACE` 可以创建新的正式 PrintTask；`EXPIRED / REVOKED` 会阻止新任务。
- 已经创建的 PrintTask 使用冻结 snapshot，订阅状态变化不会破坏历史任务审计和故障恢复。
- 外部在线数据库不可用时，12 张官方精选目录仍然可以浏览；本地模板设计、正式打印和历史任务完全不受影响。
- SQL 模式模板下载后，如果其中的 `connectionId` 不存在于当前环境，需要先在本地重新映射数据源并完成测试 / 审核后再发布。

### 可选：外部在线模板适配器

当前 FastAPI 运行时默认不启用外部在线模板数据库。相关 API 契约保留，但外部 provider 未配置时会明确报告不可用，不会伪造成功。

基础开关：

```bash
PRINT_CLOUD_TEMPLATE_ENABLED=false
PRINT_CLOUD_TEMPLATE_PROVIDER=external-adapter
PRINT_CLOUD_TEMPLATE_PUBLISHER_ENABLED=false
```

如后续接入 Neon / PostgreSQL，应在 Python provider adapter 中读取 Secret，并保持本地模板与正式打印链路不依赖外部在线目录。

### 在线模板中心 v1

当前官方精选目录包含：

| 分类 | 模板 | 权益 | 纸张 |
| --- | --- | --- | --- |
| 财务 | 专业商业发票 | FREE | A4 |
| 销售 | 简洁商务报价单、现代销售订单 | FREE | A4 |
| 采购 | 专业采购订单 | PRO | A4 |
| 物流 | 轻量送货单 | FREE | A5 |
| 财务 | 供应商对账单 | PRO | A4 |
| 仓储 | 仓库盘点单 | FREE | A4 |
| 零售 | 80mm 零售小票 | FREE | 80mm AUTO |
| 零售 | 80mm 会员消费小票 | PRO | 80mm AUTO |
| 医疗 | 医疗费用明细清单 | PRO | A4 |
| 医疗 | 70×40 药品标签 | FREE | 70×40mm |
| 物流 | 100×70 物流标签 | PRO | 100×70mm |

模板中心的“在线模板中心”页支持分类筛选、全文搜索、FREE / PRO 筛选、推荐筛选、设计驱动缩略图、完整在线预览，以及安装 / 升级到本地受管模板缓存。

## 内置业务模板

平台启动时会初始化 18 张可直接预览和打印的业务模板，全部保留 JSON 样例数据，也可以在设计器中切换为 SQL 多查询模式。

| 业务族 | 模板 | 纸张 / 特点 |
| --- | --- | --- |
| 进销存单据 | 采购订单、销售订单、入库单、出库单、库存盘点单 | A4 纵向；真实主表字段、明细、合计、备注、签字区 |
| 库存与经营报表 | 库存现状表、库存流水表、采购明细表、销售明细表、销售汇总表 | A4 横向；筛选口径、指标区、多列明细、跨页表头 |
| 门诊业务 | 门诊缴费票据、费用明细清单、日结算汇总表 | 缴费票据 A5；费用清单 A4；日结表 A4 横向 |
| 打印运营 | 打印任务明细、失败重试统计、按模板/打印机汇总 | A4 横向；直接对应 PrintTask、重试和打印机运营维度 |

门诊缴费票据是业务缴费凭据，模板中明确标注“不作为税务发票”，不使用“门诊收费发票”等易产生法律含义的名称。

### 内置模板安全升级

内置模板升级不会无条件覆盖已有模板：

- 新数据库直接创建当前业务化版本。
- 旧数据库中，只有仍处于系统初始 `v1`、状态为 `PUBLISHED`、且初始版本说明仍为 `内置模板初始化` 的模板会自动升级。
- 已保存草稿、已停用、或已经由用户发布到 `v2+` 的模板不会被自动覆盖。
- 自动升级通过正常的 `saveDraft → TESTING → REVIEWING → publish` 流程生成新的不可变版本，并保留旧版本和审计记录。

## 可视化模板设计器

设计器采用三栏布局：

```text
组件 / 图层 | 打印画布 | 属性 / 纸张 / 数据 / 照片参照
```

### 基础编辑

- 点击或拖拽添加组件
- 移动
- 缩放
- 复制
- 删除
- 图层上移 / 下移
- 锁定 / 解锁
- 显示 / 隐藏
- 撤销 / 重做
- Delete / Backspace 删除
- Ctrl/Cmd + Z 撤销
- Ctrl/Cmd + Y 重做
- 网格
- 5mm 吸附
- 智能参考线
- 标尺
- 打印边距可视化
- 左 / 中 / 右对齐
- 上 / 中 / 下对齐

### 纸张

- A4
- A5
- 80mm 小票
- 100×60 标签
- 自定义宽高
- 横向 / 纵向
- DPI
- 四边边距

### 组件

- 文本
- 长文本
- 标题
- 图片
- 线条
- 矩形
- 动态表格
- 条码
- 二维码
- 日期
- 页码
- 金额
- 页眉
- 页脚
- 水印

### 样式

- 字体
- 字号
- 粗体
- 斜体
- 下划线
- 文字颜色
- 背景色
- 边框颜色
- 边框宽度
- 水平对齐
- 垂直对齐
- 透明度
- 旋转

### 数据绑定

支持：

```text
{{patientName}}
{{order.code}}
{{page}}
{{pages}}
```

并支持样例 JSON 编辑、嵌套字段解析、模板变量发布前校验。

## 高级动态表格

表格支持：

- 自定义列
- 列顺序
- 列宽
- 字段绑定
- 文本 / 数字 / 金额 / 日期格式
- SUM / COUNT / AVG 汇总
- 多行表头
- 表头单元格 colSpan / rowSpan
- 明细单元格合并
- 明细单元格拆分
- 动态明细
- 分组
- 分组小计
- 总计
- 空数据隐藏
- 每页行数
- 自动分页
- 跨页重复表头
- 固定合计区域

### 报表打印增强

动态表格当前支持：

- 跨页重复表头
- 分组小计
- **本页小计**
- 全表总计
- 固定合计区
- SUM / COUNT / AVG
- 多页分页

预览 / 测试打印支持页范围表达式，例如 `1-3,5`。正式 PrintTask 默认仍执行完整冻结文档，避免只打印部分页却把整单任务记为成功。

打印机 Profile 支持每台设备独立套打校准：

- X 偏移：-20mm ～ 20mm
- Y 偏移：-20mm ～ 20mm
- 缩放：80% ～ 120%

校准只作用于指定物理打印机，不修改模板设计本身。

## 多页预览与打印

> `print-console` 是平台管理后台，不是业务系统前端。平台内设计器预览与业务系统嵌入式预览是两个宿主入口，但共享同一套模板 / 分页语义。

模板预览使用与打印相同的分页结果。

支持：

- 多页预览
- 页眉 / 页脚 / 水印跨页
- 页码与总页数
- 动态表格分页
- 重复表头
- 最后一页总计
- 导出打印 HTML
- 浏览器打印
- 浏览器“另存为 PDF”

平台管理后台入口：

```text
模板设计器 → 分页预览 / 打印
```

业务系统页面无需嵌入 `print-console`。推荐使用：

```text
@print-platform/sdk-core          → 获取已发布模板 + 运行时业务数据
@print-platform/preview-browser   → 在宿主页面 iframe 中渲染预览
browser-extension                 → 把 printHtml 桥接到本地 Print Agent
```

业务接入详见 `docs/BUSINESS-INTEGRATION.md`。

## 条码与二维码

前端使用：

- `qrcode`
- `jsbarcode`

二维码和条码不是占位图，设计器与打印预览均生成真实编码图形。

支持常见条码格式：

- CODE128
- CODE39
- EAN13
- EAN8
- UPC

## 图片

图片组件支持本地上传 PNG / JPEG / SVG。

图片数据作为模板设计的一部分保存，可直接用于预览与打印。

## 发票 / 表单照片参照

设计器支持上传 PNG / JPG 作为纸张版式参照。

已实现：

- 自动建议四角
- 手工拖动四角
- 透视校正
- 旋转
- DPI / 实际纸张尺寸
- 原图
- 校正图
- 叠加
- difference 对比
- 透明度
- 背景锁定
- 敏感图片确认

这些能力不依赖外部 AI。

## AI 版式识别

AI 是可选能力，不影响手工设计和正式打印。

后端提供 Provider Adapter：

```text
POST /api/templates/{templateId}/ai-layout
GET  /api/templates/{templateId}/ai-layout/tasks
```

配置：

```bash
PRINT_AI_LAYOUT_ENDPOINT=https://your-ai-adapter.example/layout
PRINT_AI_PROVIDER=your-provider
PRINT_AI_MODEL=your-model
PRINT_AI_API_KEY=...
```

未配置 `PRINT_AI_LAYOUT_ENDPOINT` 时：

- 照片校正仍可正常工作
- 手工模板设计仍可正常工作
- 打印仍可正常工作
- AI 接口返回 `UNAVAILABLE`
- 不会伪造 AI 识别结果

AI 返回的候选组件必须人工确认后才能进入模板。

## 发布前校验

当前校验包括：

- 纸张设置
- 纸张宽高
- 组件 ID
- 重复组件 ID
- 组件宽高
- 越界警告
- binding 是否存在
- 表格 binding 是否为数组
- `{{variable}}` 是否存在于样例数据
- 表格是否有列
- 分页行数合法性

阻断错误存在时不能提交审核或发布。

## 平台数据库

开发阶段默认：

```text
sqlite:///./print-platform.db
```

主要表：

```text
print_task
print_snapshot
print_attempt
data_source_connection
print_template
print_template_version
print_template_release
print_template_audit
print_template_ai_task
```

SQLite 文件已加入 `.gitignore`。

## 外部业务数据库

当前 Python 运行时已启用 **SQLite 只读业务数据源**，支持模板 SQL 模式的参数化查询、连接测试和正式打印数据准备。

MySQL、PostgreSQL、SQL Server、Oracle 的 `dbType` 契约仍保留，但 Python adapter 尚未启用；选择这些类型时后端会明确返回不可用，不会伪造连接或查询成功。

业务数据源与平台自身 SQLite 完全分开。

连接配置保存：

- dbType
- jdbcUrl
- username
- secretRef
- readOnly
- enabled

数据库密码不直接持久化到 SQLite。

## 本地启动

### 后端

要求 Python 3.11+。

```bash
cd backend/print-platform-python
python -m pip install -e '.[dev]'
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

后端：

```text
http://localhost:8080
```

### 前端

要求 Node.js 22+。

```bash
cd frontend/print-console
npm install
npm run dev
```

打开：

```text
http://localhost:5173
```

### 业务系统打印 Demo

这是消费方业务页面，不是 `print-console`：

```bash
cd frontend/business-print-demo
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

Demo 内置三个真实平台模板场景：

- A4 210×297mm 多页费用明细
- 80mm 自动高度收费小票
- 70×40mm 药品标签

页面支持平台预览、PaperModel 自动缩放、扩展 / Agent 状态检测、本机打印机列表、测试打印和正式 PrintTask 状态闭环。完整启动和验收步骤见 `docs/BUSINESS-DEMO.md`。

### Print Agent

```bash
cd print-agent
npm install
npm run dev
```

Agent 默认使用 `mock`，不会伪造物理打印成功。生产环境可启用 `command` adapter，把冻结后的打印 HTML 交给本机受控打印命令执行；Windows 下 Agent 还会尝试读取系统打印机列表。

示例：

```bash
PRINT_AGENT_ADAPTER=command
PRINT_AGENT_COMMAND=C:\\print-tools\\print-html.cmd
PRINT_AGENT_ARGS_JSON=["{file}","{printer}","{copies}","{width}","{height}"]
```

`command` adapter 使用无 shell 的进程参数调用；外部命令 exit code 为 0 才返回 `executed=true`。当前这一成功语义表示“打印命令执行成功”，不等同于已经确认纸张物理出纸。严格的 Windows spooler Job 完成状态仍属于后续增强项。

## 自动化验证

GitHub Actions 当前执行：

```text
Backend:
  python -m compileall -q app tests
  python -m ruff check app tests
  python -m pytest
  node ../../tools/functional/functional-tests.mjs
  alembic upgrade head

Frontend:
  npm install
  npm run build

SDK:
  npm install
  npm run build

Print Agent:
  npm install
  npm run build
```

Python 后端集成与兼容测试覆盖：

- SQLite 启动建表与 Alembic bootstrap
- 打印任务持久化、状态机与并发状态保护
- 外部 SQLite 只读连接测试与 SQL 模板查询
- 模板创建、草稿、测试、审核、发布、版本与回滚
- 正式打印只使用不可变发布版本
- JSON 正式打印 runtime inputData 保护
- PDF / RAW payload 校验与不可变 snapshot
- 打印机停用保护
- API Key 身份认证与 VIEWER / DESIGNER / OPERATOR / ADMIN RBAC
- Entitlement 过期 / 撤销的正式打印保护
- 报表、系统日志与日志保留清理
- 在线模板与外部 AI 未配置时 fail closed
- OpenAPI method/path 契约
- Windows Microsoft Print to PDF 真实打印

## 工程目录

```text
frontend/print-console/      # Vue 3 平台管理控制台与模板设计器（不是业务系统前端）
frontend/business-print-demo/ # 业务系统打印组件完整 Demo
backend/print-platform-python/ # FastAPI 平台服务
sdk/print-sdk-core/          # 业务系统访问平台 API 的框架无关 TypeScript SDK
sdk/print-preview-browser/   # 业务页面可嵌入预览渲染器
browser-extension/           # 业务页面到本地 Print Agent 的 Chromium 扩展桥
print-agent/                 # 本地打印代理
contracts/openapi/           # API 契约
docs/                        # 架构与规格
```

## 原型

早期原型仍保留，作为产品设计参考：

- `prototype-directions.html`
- `print-platform-complete.html`
- `PRD-打印平台.md`

正式开发以后端与 `frontend/print-console` 为准。
