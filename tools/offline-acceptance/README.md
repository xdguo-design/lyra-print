# Offline Acceptance Bundle

这个 ZIP 是打印平台的离线验收包，后端为 Python/FastAPI。

## 内容
- `backend/wheelhouse/`：打印平台 Python wheel 及其离线依赖
- `frontend/`：Vite production dist
- `print-agent/dist/`：Print Agent 编译产物
- `scripts/acceptance.mjs`：完整真实验收脚本
- `reports/npm-audit.json`：构建时连接 npm Registry 执行的实时审计结果
- `manifest.json`：构建提交、时间与运行时版本

## 运行要求
本机只需要：
- Python 3.11+
- Node.js 22+
- Chromium
- pdfinfo (poppler-utils)

无需 JDK、Maven、npm install 或网络。验收脚本会创建临时 Python venv，并仅从 `backend/wheelhouse/` 安装后端。

## 执行
```bash
node scripts/acceptance.mjs
```

脚本会启动 FastAPI 后端、SQLite、前端静态服务器/反向代理、Print Agent 和 Chromium，
执行 UI 设计器操作、发布/回滚、真实 PDF、状态机、异常场景和重启持久化测试。

结果输出为：
- `acceptance-report.json`
- `acceptance-report.md`
- `.acceptance-work/logs/*`
- `.acceptance-work/offline-acceptance.pdf`

注意：离线验收包为了可重复运行，Print Agent 仍使用 mock adapter，因此这一条离线验收本身不代表操作系统打印。

真实 Windows 打印由 CI 的 `windows-real-print` Gate 单独验证：它通过真实 HTTP API 创建、排队并启动 PrintTask，使用 Print Agent production command adapter 调用 `Microsoft Print to PDF`，验证实际 PDF 文件落盘、PDF 头和 PrintTask/Attempt SUCCESS，并上传 `windows-real-print` artifact 作为验收证据。
