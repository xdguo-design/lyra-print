# XD Frontend Standard v1

平台型 Web 项目统一采用：

- React + TypeScript strict
- Vite
- Ant Design React
- React Router
- TanStack Query：服务端状态
- Zustand：少量跨页面客户端状态
- Axios + Zod：HTTP 与数据边界
- React Hook Form：复杂表单
- Vitest + React Testing Library + MSW：单元/组件测试
- Playwright：关键业务 E2E
- ESLint + Prettier
- pnpm + Node 22 LTS

统一目录：

```
src/
├── app/
│   ├── layout/
│   ├── providers/
│   ├── router/
│   └── config/
├── features/
├── pages/
├── shared/
│   ├── api/
│   ├── components/
│   ├── hooks/
│   └── utils/
├── stores/
├── theme/
└── main.tsx
```

规则：

1. 不再新增 Vue 页面或 Vue 组件。
2. API 数据进入 TanStack Query，不使用 Zustand 存服务端列表/详情。
3. 筛选、分页、排序、当前资源 ID 优先进入 URL。
4. Feature 只通过公开入口向外暴露能力，不跨 Feature 深层引用。
5. 业务组件不得直接处理 AxiosError，统一转换为 ApiError。
6. Loading、Empty、Error、Status、Drawer、Table 等体验逐步沉淀到共享 UI。
7. 每个 React Feature 合并前至少通过 lint、typecheck、Vitest、build；关键流程补 Playwright。
8. React 迁移完成后删除旧 Vue 运行时、Vue 构建插件和 Ant Design Vue。

打印平台采用并行迁移策略：旧 Vue 控制台在功能迁移完成前继续可用，新 React 控制台独立构建和测试；迁完打印节点、打印任务、模板中心、模板设计器并完成回归后一次性切主入口，不长期保留双栈。
