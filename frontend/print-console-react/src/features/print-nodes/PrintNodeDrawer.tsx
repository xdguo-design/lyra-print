import { Alert, Button, Descriptions, Drawer, Progress, Space, Table, Tabs, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import type { AgentHeartbeat, AgentInstance } from '@/features/print-nodes/model'
import { PrinterTab } from '@/features/print-nodes/PrinterTab'
import { printNodeKeys, useNodeHeartbeats } from '@/features/print-nodes/queries'
import {
  formatTime,
  healthLabel,
  nodeState,
  nodeStateLabel,
  percent,
  printHealth,
  spoolerHealthy,
  timeAgo,
} from '@/features/print-nodes/status'
import { ErrorState, LoadingState } from '@/shared/components/StateViews'

export type NodeDrawerTab = 'overview' | 'printers' | 'runtime' | 'heartbeats'

interface Props {
  node: AgentInstance | undefined
  open: boolean
  tab: NodeDrawerTab
  onClose: () => void
  onTabChange: (tab: NodeDrawerTab) => void
}

function OverviewTab({ node }: { node: AgentInstance }) {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <div className="drawer-metrics">
        <div><span>活跃任务</span><strong>{node.activeJobs}</strong></div>
        <div><span>排队任务</span><strong>{node.queuedJobs}</strong></div>
        <div><span>本机打印机</span><strong>{node.printerCount}</strong></div>
        <div><span>客户端版本</span><strong className="small-value">v{node.agentVersion.replace(/^v/i, '')}</strong></div>
      </div>

      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="节点名称">{node.hostName || node.instanceId}</Descriptions.Item>
        <Descriptions.Item label="节点状态">{nodeStateLabel[nodeState(node)]}</Descriptions.Item>
        <Descriptions.Item label="Agent ID"><span className="mono">{node.agentId}</span></Descriptions.Item>
        <Descriptions.Item label="Instance ID"><span className="mono">{node.instanceId}</span></Descriptions.Item>
        <Descriptions.Item label="IP 地址">{node.ipAddress || '未上报'}</Descriptions.Item>
        <Descriptions.Item label="操作系统">{node.osName}</Descriptions.Item>
        <Descriptions.Item label="注册时间">{formatTime(node.registeredAt)}</Descriptions.Item>
        <Descriptions.Item label="最后更新">{formatTime(node.updatedAt)}</Descriptions.Item>
        <Descriptions.Item label="最后心跳" span={2}>
          {formatTime(node.lastHeartbeatAt)}（{timeAgo(node.lastHeartbeatAt)}）
        </Descriptions.Item>
      </Descriptions>

      <div className="runtime-grid">
        <div><span>打印链路</span><strong>{healthLabel[printHealth(node)]}</strong><small>与节点在线状态分开判断</small></div>
        <div><span>系统 Spooler</span><strong>{node.spoolerStatus || 'UNKNOWN'}</strong><small>{spoolerHealthy(node.spoolerStatus) ? '打印服务正常或无需监控' : '需要检查系统打印服务'}</small></div>
      </div>

      <Alert
        type="info"
        showIcon
        message="页面边界"
        description="这里只管理打印执行节点与打印链路。模型、角色、Skills、Tools、Memory、Knowledge 与 Workflow 由统一 Agent 平台负责。"
      />
    </Space>
  )
}

function RuntimeTab({ node }: { node: AgentInstance }) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="runtime-grid">
        <div><span>节点心跳</span><strong>{node.status === 'ONLINE' ? '正常' : node.status}</strong><small>{timeAgo(node.lastHeartbeatAt)}</small></div>
        <div><span>打印服务</span><strong>{node.spoolerStatus || 'UNKNOWN'}</strong><small>系统 Spooler</small></div>
        <div><span>CPU</span><strong>{percent(node.cpuUsage)}</strong><Progress percent={node.cpuUsage ?? 0} size="small" showInfo={false} /></div>
        <div><span>内存</span><strong>{percent(node.memoryUsage)}</strong><Progress percent={node.memoryUsage ?? 0} size="small" showInfo={false} /></div>
      </div>
      {!spoolerHealthy(node.spoolerStatus) && (
        <Alert
          type="warning"
          showIcon
          message="打印服务状态异常"
          description="节点仍可能在线，但当前打印链路不可视为健康。请检查操作系统打印服务与驱动。"
        />
      )}
    </Space>
  )
}

function HeartbeatTab({ node, active }: { node: AgentInstance; active: boolean }) {
  const query = useNodeHeartbeats(node.agentId, node.instanceId, active)

  if (query.isPending && !query.data) return <LoadingState label="正在读取心跳历史…" />
  if (query.isError && !query.data) {
    return <ErrorState title="心跳历史加载失败" message={query.error.message} onRetry={() => void query.refetch()} />
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div className="tab-toolbar">
        <div><strong>最近心跳</strong><span>最多展示最近 120 条节点运行快照</span></div>
        <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>
      </div>
      <Table<AgentHeartbeat>
        size="small"
        rowKey="id"
        dataSource={query.data ?? []}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        columns={[
          { title: '时间', dataIndex: 'createdAt', width: 190, render: (value: string) => formatTime(value) },
          { title: 'CPU', dataIndex: 'cpuUsage', width: 90, render: (value: number | null | undefined) => percent(value) },
          { title: '内存', dataIndex: 'memoryUsage', width: 90, render: (value: number | null | undefined) => percent(value) },
          { title: '活跃', dataIndex: 'activeJobs', width: 80 },
          { title: '排队', dataIndex: 'queuedJobs', width: 80 },
          { title: '打印机', dataIndex: 'printerCount', width: 90 },
          { title: 'Spooler', dataIndex: 'spoolerStatus', width: 120, render: (value: string | null | undefined) => value || 'UNKNOWN' },
          { title: '版本', dataIndex: 'agentVersion' },
        ]}
      />
    </Space>
  )
}

export function PrintNodeDrawer({ node, open, tab, onClose, onTabChange }: Props) {
  const queryClient = useQueryClient()
  if (!node) return null

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: printNodeKeys.all }),
      queryClient.invalidateQueries({ queryKey: printNodeKeys.printers(node.agentId, node.instanceId) }),
      queryClient.invalidateQueries({ queryKey: printNodeKeys.heartbeats(node.agentId, node.instanceId) }),
    ])
  }

  return (
    <Drawer
      open={open}
      width={840}
      onClose={onClose}
      title={
        <div className="drawer-title">
          <div className="node-avatar large">{(node.hostName || node.instanceId).slice(0, 1).toUpperCase()}</div>
          <div><strong>{node.hostName || node.instanceId}</strong><span className="mono">{node.agentId} / {node.instanceId}</span></div>
        </div>
      }
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>}
    >
      <div className="drawer-status-strip">
        <Tag color={nodeState(node) === 'OFFLINE' ? 'default' : nodeState(node) === 'DEGRADED' ? 'orange' : 'green'}>
          {nodeStateLabel[nodeState(node)]}
        </Tag>
        <strong>{healthLabel[printHealth(node)]}</strong>
        <span>最后心跳 {timeAgo(node.lastHeartbeatAt)}</span>
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => onTabChange(key as NodeDrawerTab)}
        items={[
          { key: 'overview', label: '概览', children: <OverviewTab node={node} /> },
          { key: 'printers', label: '打印机', children: <PrinterTab node={node} active={tab === 'printers'} /> },
          { key: 'runtime', label: '运行状态', children: <RuntimeTab node={node} /> },
          { key: 'heartbeats', label: '心跳历史', children: <HeartbeatTab node={node} active={tab === 'heartbeats'} /> },
        ]}
      />
    </Drawer>
  )
}
