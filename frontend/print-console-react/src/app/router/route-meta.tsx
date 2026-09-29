import {
  AlertOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  NodeIndexOutlined,
  PieChartOutlined,
  ProfileOutlined,
  ReadOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'

export interface AppRouteMeta {
  key: string
  path: string
  label: string
  icon: ReactNode
}

export const appRoutes: AppRouteMeta[] = [
  { key: 'overview', path: '/', label: '平台概览', icon: <PieChartOutlined /> },
  { key: 'templates', path: '/templates', label: '模板中心', icon: <FileTextOutlined /> },
  { key: 'sources', path: '/data-sources', label: '数据源', icon: <DatabaseOutlined /> },
  { key: 'tasks', path: '/print-tasks', label: '打印任务', icon: <ProfileOutlined /> },
  { key: 'nodes', path: '/print-nodes', label: '打印节点', icon: <NodeIndexOutlined /> },
  { key: 'alerts', path: '/alerts', label: '告警中心', icon: <AlertOutlined /> },
  { key: 'logs', path: '/logs', label: '系统日志', icon: <ReadOutlined /> },
  { key: 'reports', path: '/reports', label: '运营报表', icon: <SettingOutlined /> },
]
