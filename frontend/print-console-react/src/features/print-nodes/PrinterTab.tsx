import { Alert, Button, Card, Space, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { AgentInstance, AgentPrinter } from '@/features/print-nodes/model'
import { useNodePrinters } from '@/features/print-nodes/queries'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/StateViews'
import { formatTime, timeAgo } from '@/features/print-nodes/status'

function printerTone(status: string) {
  const value = status.toUpperCase()
  if (['ONLINE', 'READY', 'IDLE'].includes(value)) return 'green'
  if (['ATTENTION', 'WARNING', 'BUSY', 'PRINTING'].includes(value)) return 'orange'
  if (['ERROR', 'FAILED', 'FAULT'].includes(value)) return 'red'
  return 'default'
}

function printerStatusLabel(status: string) {
  const value = status.toUpperCase()
  const labels: Record<string, string> = {
    ONLINE: '在线',
    READY: '就绪',
    IDLE: '空闲',
    ATTENTION: '需关注',
    WARNING: '告警',
    BUSY: '忙碌',
    PRINTING: '打印中',
    ERROR: '故障',
    FAILED: '失败',
    FAULT: '故障',
    OFFLINE: '离线',
    DISCONNECTED: '已断开',
  }
  return labels[value] ?? value
}

function PrinterCard({ printer }: { printer: AgentPrinter }) {
  return (
    <Card className="printer-card" size="small">
      <div className="printer-card-head">
        <div className="printer-title">
          <div className="printer-mark">P</div>
          <div>
            <strong>{printer.name}</strong>
            <span className="mono">{printer.printerId}</span>
          </div>
        </div>
        <Space size={6} wrap>
          <Tag color={printerTone(printer.status)}>{printerStatusLabel(printer.status)}</Tag>
          {printer.defaultPrinter && <Tag color="blue">系统默认</Tag>}
          <Tag>{printer.type}</Tag>
        </Space>
      </div>

      <div className="printer-detail-grid">
        <div><span>驱动</span><strong>{printer.driverName || '未上报'}</strong></div>
        <div><span>端口</span><strong className="mono">{printer.portName || '未上报'}</strong></div>
        <div><span>位置</span><strong>{printer.location || '未设置'}</strong></div>
        <div><span>共享</span><strong>{printer.shared ? printer.shareName || '已共享' : '未共享'}</strong></div>
        <div><span>首次发现</span><strong>{formatTime(printer.firstSeenAt)}</strong></div>
        <div>
          <span>最近发现</span>
          <strong>{timeAgo(printer.lastSeenAt)}</strong>
          <small>{formatTime(printer.lastSeenAt)}</small>
        </div>
        <div className="printer-paper">
          <span>纸张能力</span>
          <Space size={[4, 4]} wrap>
            {printer.paperSizes.length ? printer.paperSizes.map((paper) => <Tag key={paper}>{paper}</Tag>) : <strong>未上报</strong>}
          </Space>
        </div>
      </div>

      {printer.comment && <div className="printer-comment">{printer.comment}</div>}
    </Card>
  )
}

export function PrinterTab({ node, active }: { node: AgentInstance; active: boolean }) {
  const query = useNodePrinters(node.agentId, node.instanceId, active)

  if (query.isPending && !query.data) return <LoadingState label="正在读取节点打印机明细…" />

  if (query.isError && !query.data) {
    return (
      <ErrorState
        title="打印机明细加载失败"
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    )
  }

  const printers = query.data ?? []

  if (!printers.length) {
    const legacy = node.printerCount > 0
    return (
      <EmptyState
        title={legacy ? `节点已上报 ${node.printerCount} 台打印机，但暂无明细` : '该节点当前没有发现打印机'}
        description={
          legacy
            ? '这通常表示节点仍在使用旧版 Agent，或明细心跳尚未到达。刷新后仍为空时请升级并重启该节点 Agent。'
            : '请确认操作系统已经安装打印机，并检查 Agent 是否具备打印机枚举权限。'
        }
        action={
          <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>
            重新读取
          </Button>
        }
      />
    )
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div className="tab-toolbar">
        <div>
          <strong>本机打印机明细</strong>
          <span>节点计数 {node.printerCount} 台 · 当前明细 {printers.length} 台</span>
        </div>
        <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>
          刷新打印机
        </Button>
      </div>

      {query.isError && (
        <Alert
          type="warning"
          showIcon
          message="本次刷新失败，继续展示上一次成功数据"
          description={query.error.message}
        />
      )}

      {node.printerCount !== printers.length && (
        <Alert
          type="warning"
          showIcon
          message={`节点计数 ${node.printerCount} 台，当前明细 ${printers.length} 台`}
          description="计数和明细可能来自相邻心跳快照；刷新后仍不一致再检查 Agent 上报。"
        />
      )}

      <div className={query.isFetching ? 'printer-list is-refreshing' : 'printer-list'}>
        {printers.map((printer) => <PrinterCard key={printer.printerId} printer={printer} />)}
      </div>
    </Space>
  )
}
