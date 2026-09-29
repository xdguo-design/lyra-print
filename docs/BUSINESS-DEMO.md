# 业务打印完整 Demo

这个 Demo 模拟一个真实业务系统页面，角色与 `print-console` 完全分离。

## 能验证什么

- 业务前端加载统一打印预览组件
- A4 210×297mm 多页分页
- 80mm 卷纸自动高度
- 70×40mm 固定药品标签
- PaperModel 尺寸识别、校验和响应式缩放
- 业务页面通过 SDK 调用已发布模板预览
- 浏览器扩展发现本地 Print Agent 与打印机
- 测试打印
- 正式 PrintTask 创建、排队、开始、成功 / 失败状态闭环
- 正式打印使用 PrintTask 冻结后的 design + renderData，而不是重新取模板

## 启动顺序

### 1. 平台后端

```bash
cd backend/print-platform
mvn spring-boot:run
```

默认地址：`http://localhost:8080`。

后端首次启动会自动创建 Demo 使用的两个真实已发布模板：

- `demo-roll-receipt`：80mm 自动高度收费小票
- `demo-medicine-label`：70×40mm 药品标签

A4 场景使用现有 `outpatient-expense-list`。

### 2. Print Agent

```bash
cd print-agent
npm install
npm run build
npm start
```

默认地址：`http://127.0.0.1:18181`。

默认 mock adapter 可以验证扩展与 Agent 通道，但正式 PRODUCTION 打印会被拒绝，这是安全设计。要验证真实物理打印，请按 Print Agent 文档启用生产 adapter。

### 3. 加载浏览器扩展

Chrome / Edge：

1. 打开扩展管理页。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择仓库中的 `browser-extension/`。
5. 刷新业务 Demo 页面。

扩展只负责业务页面与本地 Print Agent 之间的桥接，不负责模板渲染。

### 4. 业务前端 Demo

```bash
cd frontend/business-print-demo
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

`npm run dev` 会自动为本地两个 SDK 安装依赖，业务 Demo 直接引用仓库中的 SDK 源码，保证示例始终验证当前分支实现。

## 三类纸张

### A4

- 模板：`outpatient-expense-list`
- 纸张：210×297mm
- 高度：固定
- 预览：FIT
- 内容超过每页行数后自动分页

Demo 默认放入 27 条费用明细，用来直接观察分页行为。

### 80mm 小票

- 模板：`demo-roll-receipt`
- 纸张：80mm
- 高度：AUTO
- 上限：1000mm
- 预览：FIT
- 表格增长时，后续合计、二维码和底部信息自动向下移动

### 70×40 标签

- 模板：`demo-medicine-label`
- 纸张：70×40mm
- 高度：固定
- DPI：203
- 预览可以放大展示，但 `printHtml` 始终保持 70×40mm

## 预览尺寸为什么不会影响打印尺寸

业务组件预览链路：

```text
Template.paper
  -> PaperModel
  -> calculatePreviewScale()
  -> iframe 中 transform: scale(...)
```

打印链路：

```text
Template.paper
  -> renderPreview()
  -> printHtml
  -> @page size: <真实 mm>
  -> Extension
  -> Agent
  -> Printer
```

预览缩放值不会写入 `printHtml`。因此页面上 A4 被缩小、标签被放大，都不会改变实际打印物理尺寸。

## 正式打印状态闭环

业务 Demo 的“正式打印”按钮会按顺序执行：

```text
POST /api/print-tasks
POST /api/print-tasks/{id}/queue
POST /api/print-tasks/{id}/start
GET  /api/print-tasks/{id}/document
window.postMessage -> Extension -> Agent
POST /api/print-tasks/{id}/success
```

任何本地打印错误会尝试回写：

```text
POST /api/print-tasks/{id}/fail
```

所以可以在 `print-console` 的任务中心看到 Demo 发起的正式任务。

## API Key

默认开发模式可留空。

启用后端 RBAC 后，Demo 输入的是 OPERATOR Key。它只用于本地联调。生产业务系统不应该把长期 API Key 编进浏览器 bundle；推荐由业务系统后端 / BFF 持有 Key，再向前端提供必要的数据或短期凭证。

## CORS

本地默认允许：

```text
http://localhost:5173
http://localhost:3000
```

生产部署通过：

```bash
PRINT_CORS_ALLOWED_ORIGINS=https://his.example.com,https://erp.example.com
```

显式配置允许的业务系统 Origin。
