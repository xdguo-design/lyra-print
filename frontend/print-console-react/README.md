# Print Console React Migration

这是打印平台控制台的 React/TypeScript 迁移应用。

- 旧版 `frontend/print-console` 在迁移完成前继续承担现有验收能力。
- 新版 `frontend/print-console-react` 只使用 React + TypeScript，不允许新增 Vue。
- 每个 Feature 合并前必须通过 lint、typecheck、Vitest 和 build。
- 打印节点、打印任务、模板中心、模板设计器迁完并完成回归后，再切主入口并删除旧 Vue 应用。

统一基线：React + TypeScript strict、Vite、Ant Design React、React Router、TanStack Query、Zustand、Axios + Zod、React Hook Form、Vitest + React Testing Library + MSW、Playwright、ESLint + Prettier、pnpm。

本目录是迁移期临时名称，最终会替代 `frontend/print-console`，不会长期保留双栈。
