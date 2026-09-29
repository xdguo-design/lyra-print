# 业务系统接入指南

## 角色边界

Print Platform 里有四个不同角色，不能混为同一个“前端”：

| 组件 | 角色 | 默认端口 / 位置 |
| --- | --- | --- |
| `print-console` | 平台管理后台：模板设计、任务管理、报表、运维 | 5173 |
| 业务系统前端 | 平台能力的消费方，嵌入在 HIS / EMR / ERP / 收费等宿主页面中 | 由业务系统决定 |
| 浏览器扩展 | 将宿主页面的本地打印指令桥接到 Print Agent | Chromium extension |
| `print-agent` | 本机打印执行器，发现打印机、提交作业、观察 Spooler | 18181 |

业务系统不应该把 `print-console` 当成自己的打印页面。Console 是平台内部管理入口。

## 推荐生产架构

```text
业务系统后端
  │
  │  @print-platform/sdk-core
  │  HTTPS + OPERATOR API Key
  ▼
Print Platform :8080
  │
  ├─ POST /api/print-previews
  ├─ POST /api/print-tasks
  └─ GET  /api/print-tasks/{id}/document

业务系统前端
  │
  ├─ @print-platform/preview-browser
  │     └─ iframe 预览（不依赖 print-console）
  │
  └─ window.postMessage
        ▼
浏览器扩展
        ▼
Print Agent :18181
        ▼
系统打印机 / Windows Spooler
```

生产环境建议由业务系统后端持有 Print Platform 的 OPERATOR API Key。不要把长期 API Key 打进公开浏览器 bundle。业务前端只接收预览所需的 `design + renderData`，以及正式打印任务 ID 等非密钥数据。

如果是受控内网调试环境，需要让业务浏览器直接访问平台 API，可以通过：

```bash
PRINT_CORS_ALLOWED_ORIGINS=http://localhost:3000,https://his.example.com
```

配置允许的宿主 Origin。生产环境仍建议走业务系统自己的 BFF / 后端代理。

## 1. 业务预览

业务预览只读取**当前已发布模板版本**，不会创建 PrintTask，也不会访问浏览器扩展或 Print Agent。

### SDK

```ts
import { PrintPlatformClient } from '@print-platform/sdk-core'

const client = new PrintPlatformClient({
  baseUrl: 'https://print.example.com',
  apiKey: process.env.PRINT_PLATFORM_OPERATOR_KEY
})

const preview = await client.createPreview({
  templateCode: 'OUTPATIENT-RECEIPT',
  inputData: {
    patientName: '张三',
    patientNo: 'P10001',
    amount: 88.5,
    items: []
  }
})
```

SQL 模式模板使用 `params`，JSON 模式模板使用 `inputData`。规则和正式 PrintTask 的数据解析规则一致。

### 嵌入宿主页面

```ts
import { mountPreview } from '@print-platform/preview-browser'

const host = document.querySelector('#print-preview') as HTMLElement
await mountPreview(host, preview, {
  height: '680px'
})
```

预览通过独立 iframe 渲染，宿主业务系统的 CSS 不会污染打印版式。

支持：

- 多页分页
- 页眉 / 页脚 / 水印
- 页码 / 总页数
- 动态表格
- 分组 / 小计 / 总计
- 自动收据高度
- 图片
- 二维码
- 条码
- A4 / A5 / 小票 / 标签 / 自定义纸张

## 2. 创建正式打印任务

预览确认后，再创建正式 PrintTask：

```ts
const task = await client.createTask({
  templateCode: 'OUTPATIENT-RECEIPT',
  businessKey: 'VISIT-20260922-001',
  printerId: 'cashier-a4-02',
  copies: 1,
  inputData: {
    patientName: '张三',
    patientNo: 'P10001',
    amount: 88.5,
    items: []
  }
})
```

正式任务创建时平台会冻结：

- templateCode
- templateVersion
- design
- renderData
- businessKey
- printerId
- copies

之后模板即使继续修改，历史任务和重试仍使用原冻结 Snapshot。

## 3. 取正式任务的冻结文档

```ts
const documentSnapshot = await client.getTaskDocument(task.id)

if (documentSnapshot.documentKind !== 'TEMPLATE') {
  throw new Error('This example expects a template document')
}
```

这一步适合：

- 正式打印前再次展示“最终将打印的内容”
- 失败重试时回看冻结内容
- 审计
- 向浏览器扩展发送与任务完全一致的 HTML

## 4. 生成预览 HTML 与打印 HTML

```ts
import { renderPreview } from '@print-platform/preview-browser'

const rendered = await renderPreview({
  templateName: documentSnapshot.templateName,
  design: documentSnapshot.design!,
  renderData: documentSnapshot.renderData!
})

console.log(rendered.pageCount)
console.log(rendered.pageSize)

// 带灰色背景和页面阴影，给业务页面预览使用
const previewHtml = rendered.html

// 无预览装饰，给浏览器打印或扩展 / Agent 使用
const printHtml = rendered.printHtml
```

## 5. 通过浏览器扩展打印

业务页面继续沿用现有 `window.postMessage` 协议：

```ts
const requestId = crypto.randomUUID()

window.postMessage({
  source: 'print-platform-page',
  type: 'PRINT',
  requestId,
  payload: {
    mode: 'PRODUCTION',
    taskId: task.id,
    printerId: task.printerId,
    copies: task.copies,
    title: documentSnapshot.templateName,
    documentHtml: rendered.printHtml,
    pageSize: rendered.pageSize
  }
}, '*')
```

扩展只负责把已经渲染完成的打印文档交给本机 Agent，不承担模板版本选择和预览渲染职责。

当前扩展支持：

- `HEALTH`
- `LIST_PRINTERS`
- `PRINT`
- `GET_JOB`
- `LIST_SPOOLER_JOBS`
- `GET_SPOOLER_BINDING`
- `CONTROL_SPOOLER`

预览不需要增加扩展消息类型。

## 6. 为什么不把 PREVIEW 加进 Agent

预览属于浏览器 UI 能力，不属于物理打印执行能力。

把预览放进 Agent 会产生几个问题：

- 未安装 Agent 就不能预览
- Web 页面需要跨进程取 HTML / 图片
- Windows / Linux / macOS 的 Agent 实现容易出现渲染差异
- 业务系统预览和 print-console 更难保持同一套模板语义

因此当前边界是：

```text
平台：模板版本 + 数据解析
浏览器 preview package：版式渲染
扩展：浏览器 -> Agent 通道
Agent：物理打印
```

## 7. 权限

`POST /api/print-previews` 和正式 PrintTask 写操作都属于 `OPERATOR` 权限。

平台管理能力仍保持原边界：

- VIEWER：只读平台数据
- DESIGNER：模板设计、测试、审核、发布
- OPERATOR：业务预览、正式打印任务
- ADMIN：平台管理

这样业务消费方不需要获得模板设计权限。
