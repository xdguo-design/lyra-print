import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Col, Input, Row, Select, Space, Table, Tag } from 'antd'
import type { TableProps } from 'antd'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PrintNodeDrawer, type NodeDrawerTab } from '@/features/print-nodes/PrintNodeDrawer'
import type { AgentInstance, NodeState, PrintHealth } from '@/features/print-nodes/model'
import { usePrintNodes } from '@/features/print-nodes/queries'
import {
  formatTime,
  healthLabel,
  nodeState,
  nodeStateLabel,
  percent,
  printHealth,
  shortOs,
  timeAgo,
} from '@/features/print-nodes/status'
import { ErrorState } from '@/shared/components/StateViews'
import { PageHeader } from '@/shared/components/PageHeader'
import './print-nodes.css'

function nodeKey(node: AgentInstance) {
  return node.agentId + '::' + node.instanceId
}

function stateColor(state: NodeState) {
  if (state === 'ONLINE') return 'green'
  if (state === 'BUSY') return 'blue'
  if (state === 'DEGRADED') return 'orange'
  return 'default'
}

function healthColor(health: PrintHealth) {
  if (health === 'HEALTHY') return 'green'
  if (health === 'DEGRADED') return 'orange'
  if (health === 'UNBOUND') return 'purple'
  return 'default'
}

export function PrintNodesPage() {
  const query = usePrintNodes()
  const [params, setParams] = useSearchParams()
  const rows = query.data ?? []

  const keyword = params.get('q') ?? ''
  const status = params.get('status') ?? 'ALL'
  const health = params.get('health') ?? 'ALL'
  const os = params.get('os') ?? 'ALL'
  const version = params.get('version') ?? 'ALL'
  const selectedAgent = params.get('agent')
  const selectedInstance = params.get('instance')
  const tab = (params.get('tab') ?? 'overview') as NodeDrawerTab

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params)
    if (!value || value === 'ALL') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const osOptions = useMemo(() => [...new Set(rows.map((row) => shortOs(row.osName)))].sort(), [rows])
  const versionOptions = useMemo(() => [...new Set(rows.map((row) => row.agentVersion))].sort(), [rows])

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const q = keyword.trim().toLowerCase()
        if (
          q &&
          ![row.agentId, row.instanceId, row.hostName, row.ipAddress, row.osName, row.agentVersion]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(q))
        ) return false
        if (status !== 'ALL' && nodeState(row) !== status) return false
        if (health !== 'ALL' && printHealth(row) !== health) return false
        if (os !== 'ALL' && shortOs(row.osName) !== os) return false
        if (version !== 'ALL' && row.agentVersion !== version) return false
        return true
      }),
    [rows, keyword, status, health, os, version],
  )

  const metrics = useMemo(() => {
    const online = rows.filter((row) => ['ONLINE', 'BUSY'].includes(nodeState(row))).length
    const busy = rows.filter((row) => nodeState(row) === 'BUSY').length
    const degraded = rows.filter((row) => ['DEGRADED', 'UNBOUND'].includes(printHealth(row))).length
    const offline = rows.filter((row) => nodeState(row) === 'OFFLINE').length
    const printers = rows.reduce((sum, row) => sum + row.printerCount, 0)
    const healthy = rows.filter((row) => row.status === 'ONLINE' && printHealth(row) === 'HEALTHY').length
    return {
      total: rows.length,
      online,
      busy,
      degraded,
      offline,
      printers,
      healthRate: rows.length ? Number(((healthy / rows.length) * 100).toFixed(1)) : 0,
    }
  }, [rows])

  const selectedNode = rows.find(
    (row) => row.agentId === selectedAgent && row.instanceId === selectedInstance,
  )

  const openNode = (node: AgentInstance) => {
    const next = new URLSearchParams(params)
    next.set('agent', node.agentId)
    next.set('instance', node.instanceId)
    next.set('tab', 'overview')
    setParams(next, { replace: true })
  }

  const closeNode = () => {
    const next = new URLSearchParams(params)
    next.delete('agent')
    next.delete('instance')
    next.delete('tab')
    setParams(next, { replace: true })
  }

  const columns: TableProps<AgentInstance>['columns'] = [
    {
      title: '打印节点',
      key: 'node',
      width: 250,
      fixed: 'left',
      render: (_, node) => (
        <button className="node-link" onClick={() => openNode(node)}>
          <span className="node-avatar">{(node.hostName || node.instanceId).slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{node.hostName || node.instanceId}</strong>
            <small className="mono">{node.agentId} · {node.instanceId}</small>
          </span>
        </button>
      ),
    },
    {
      title: '节点状态',
      width: 110,
      render: (_, node) => <Tag color={stateColor(nodeState(node))}>{nodeStateLabel[nodeState(node)]}</Tag>,
    },
    {
      title: '打印链路',
      width: 150,
      render: (_, node) => (
        <div>
          <Tag color={healthColor(printHealth(node))}>{healthLabel[printHealth(node)]}</Tag>
          <small className="cell-sub">Spooler {node.spoolerStatus || 'UNKNOWN'}</small>
        </div>
      ),
    },
    {
      title: '主机 / IP',
      width: 210,
      render: (_, node) => <div><strong>{node.hostName}</strong><small className="cell-sub">{node.ipAddress || '未上报 IP'} · {shortOs(node.osName)}</small></div>,
    },
    {
      title: '客户端',
      width: 120,
      render: (_, node) => <div><strong>v{node.agentVersion.replace(/^v/i, '')}</strong><small className="cell-sub">{node.osName}</small></div>,
    },
    { title: '打印机', dataIndex: 'printerCount', width: 90 },
    {
      title: '任务负载',
      width: 120,
      render: (_, node) => <div><strong>{node.activeJobs} 活跃</strong><small className="cell-sub">{node.queuedJobs} 排队</small></div>,
    },
    {
      title: '资源',
      width: 130,
      render: (_, node) => <div><span>CPU {percent(node.cpuUsage)}</span><small className="cell-sub">内存 {percent(node.memoryUsage)}</small></div>,
    },
    {
      title: '最后心跳',
      width: 175,
      render: (_, node) => <div><strong>{timeAgo(node.lastHeartbeatAt)}</strong><small className="cell-sub">{formatTime(node.lastHeartbeatAt)}</small></div>,
    },
    {
      title: '操作',
      width: 90,
      fixed: 'right',
      render: (_, node) => <Button size="small" onClick={() => openNode(node)}>详情</Button>,
    },
  ]

  if (query.isError && !query.data) {
    return <ErrorState title="打印节点加载失败" message={query.error.message} onRetry={() => void query.refetch()} />
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        eyebrow="PRINT NODE · RUNTIME"
        title="打印节点"
        description="只管理打印链路中的执行节点、打印环境和任务负载；通用 Agent 能力由 Agent 平台统一管理。"
        actions={<Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>刷新状态</Button>}
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} md={12} xl={5}><Card className="node-metric"><span>节点总数</span><strong>{metrics.total}</strong><small>{metrics.printers} 台打印机</small></Card></Col>
        <Col xs={24} md={12} xl={5}><Card className="node-metric"><span>节点在线</span><strong>{metrics.online}</strong><small>{metrics.busy} 个节点忙碌</small></Card></Col>
        <Col xs={24} md={12} xl={5}><Card className="node-metric"><span>链路异常</span><strong>{metrics.degraded}</strong><small>Spooler / 打印机异常</small></Card></Col>
        <Col xs={24} md={12} xl={5}><Card className="node-metric"><span>离线</span><strong>{metrics.offline}</strong><small>超过心跳阈值</small></Card></Col>
        <Col xs={24} md={12} xl={4}><Card className="node-metric primary"><span>健康度</span><strong>{metrics.healthRate}%</strong><small>在线且打印链路健康</small></Card></Col>
      </Row>

      <Card className="filter-card">
        <Space wrap size={10}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索节点、IP、主机名、版本"
            value={keyword}
            onChange={(event) => setParam('q', event.target.value)}
            style={{ width: 300 }}
          />
          <Select value={status} onChange={(value) => setParam('status', value)} style={{ width: 130 }} options={[
            { value: 'ALL', label: '全部状态' },
            { value: 'ONLINE', label: '在线' },
            { value: 'BUSY', label: '忙碌' },
            { value: 'DEGRADED', label: '异常' },
            { value: 'OFFLINE', label: '离线' },
          ]} />
          <Select value={health} onChange={(value) => setParam('health', value)} style={{ width: 150 }} options={[
            { value: 'ALL', label: '全部打印链路' },
            { value: 'HEALTHY', label: '链路正常' },
            { value: 'DEGRADED', label: '链路异常' },
            { value: 'UNBOUND', label: '未发现打印机' },
            { value: 'OFFLINE', label: '节点离线' },
          ]} />
          <Select value={os} onChange={(value) => setParam('os', value)} style={{ width: 130 }} options={[
            { value: 'ALL', label: '全部系统' },
            ...osOptions.map((value) => ({ value, label: value })),
          ]} />
          <Select value={version} onChange={(value) => setParam('version', value)} style={{ width: 130 }} options={[
            { value: 'ALL', label: '全部版本' },
            ...versionOptions.map((value) => ({ value, label: value })),
          ]} />
          <Button onClick={() => {
            const next = new URLSearchParams(params)
            ;['q', 'status', 'health', 'os', 'version'].forEach((key) => next.delete(key))
            setParams(next, { replace: true })
          }}>重置</Button>
        </Space>
        <div className="filter-summary">显示 <strong>{filtered.length}</strong> / {rows.length} 个节点</div>
      </Card>

      <Card className="node-table-card" styles={{ body: { padding: 0 } }}>
        <Table<AgentInstance>
          rowKey={nodeKey}
          loading={query.isPending}
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          scroll={{ x: 1380 }}
        />
      </Card>

      <PrintNodeDrawer
        node={selectedNode}
        open={Boolean(selectedNode)}
        tab={tab}
        onClose={closeNode}
        onTabChange={(nextTab) => setParam('tab', nextTab)}
      />
    </Space>
  )
}
