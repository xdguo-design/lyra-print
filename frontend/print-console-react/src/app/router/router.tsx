import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/app/layout/AppShell'
import { MigrationPage } from '@/pages/MigrationPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { PrintNodesPage } from '@/features/print-nodes/PrintNodesPage'
import { PrintTasksPage } from '@/features/print-tasks/PrintTasksPage'
import { TemplateCenterPage } from '@/features/templates/TemplateCenterPage'
import { TemplateDesignerPage } from '@/features/template-designer/TemplateDesignerPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'templates', element: <TemplateCenterPage /> },
      { path: 'templates/:templateId/design', element: <TemplateDesignerPage /> },
      { path: 'data-sources', element: <MigrationPage title="数据源" description="等待 React 业务迁移阶段接入。" /> },
      { path: 'print-tasks', element: <PrintTasksPage /> },
      { path: 'print-nodes', element: <PrintNodesPage /> },
      { path: 'alerts', element: <MigrationPage title="告警中心" description="等待 React 业务迁移阶段接入。" /> },
      { path: 'logs', element: <MigrationPage title="系统日志" description="等待 React 业务迁移阶段接入。" /> },
      { path: 'reports', element: <MigrationPage title="运营报表" description="等待 React 业务迁移阶段接入。" /> },
    ],
  },
])
