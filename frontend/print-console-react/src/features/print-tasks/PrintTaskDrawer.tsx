import { App, Alert, Button, Descriptions, Drawer, Empty, Input, Modal, Space, Table, Tabs, Tag, Typography } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { PrintAttempt, PrintTask, PrintTaskDocument } from '@/features/print-tasks/model'
import {
  printTaskKeys,
  usePrintTask,
  usePrintTaskAttempts,
  usePrintTaskDocument,
  usePrintTaskMutation,
} from '@/features/print-tasks/queries'
import {
  canCancel,
  canQueue,
  canRetry,
  formatTaskTime,
  isStalePrinting,
  taskKindLabel,
  taskStatusColor,
  taskStatusLabel,
  taskTimeAgo,
} from '@/features/print-tasks/status'
import { useQueryClient } from '@tanstack/react-query'
import { ErrorState, LoadingState } from '@/shared/components/StateViews'

export type TaskDrawerTab = 'overview' | 'attempts' | 'document'

interface Props {
  taskId: string | undefined
  open: boolean
  tab: TaskDrawerTab
  onClose: () => void
  onTabChange: (tab: TaskDrawerTab) => void
}

function downloadPdf(document: PrintTaskDocument) {
  if (!document.pdfBase64) return
  const binary = atob(document.pdfBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = (document.templateName || 'document') + '.pdf'
  anchor.click()
  URL.revokeObjectURL(url)
}

function OverviewTab({ task }: { task: PrintTask }) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="task-drawer-metrics">
        <div><span>当前状态</span><strong>{taskStatusLabel[task.status]}</strong></div>
        <div><span>打印尝试</span><strong>{task.attempts}</strong></div>
        <div><span>打印份数</span><strong>{task.copies}</strong></div>
        <div><span>文档类型</span><strong className="small-value">{taskKindLabel(task.templateCode)}</strong></div>
      </div>

      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="任务号" span={2}><span className="mono">{task.id}</span></Descriptions.Item>
        <Descriptions.Item label="模板">{task.templateCode}</Descriptions.Item>
        <Descriptions.Item label="模板版本">{task.templateVersion ? 'v' + task.templateVersion : '—'}</Descriptions.Item>
        <Descriptions.Item label="业务唯一号">{task.businessKey}</Descriptions.Item>
        <Descriptions.Item label="打印机">{task.printerId || '未指定'}</Descriptions.Item>
        <Descriptions.Item label="Snapshot"><span className="mono">{task.snapshotId}</span></Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatTaskTime(task.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{formatTaskTime(task.updatedAt)}</Descriptions.Item>
      </Descriptions>

      {task.message && (
        <Alert
          type={task.status === 'FAILED' ? 'error' : task.status === 'WAITING_AGENT' ? 'warning' : 'info'}
          showIcon
          message="任务消息"
          description={task.message}
        />
      )}

      {isStalePrinting(task) && (
        <Alert
          type="warning"
          showIcon
          message="打印状态长时间未更新"
          description="该任务已处于 PRINTING 超过 2 分钟。请先核对真实打印机 / Spooler 状态，再决定是否人工标记失败，避免重复票据。"
        />
      )}
    </Space>
  )
}

function AttemptsTab({ taskId, active }: { taskId: string; active: boolean }) {
  const query = usePrintTaskAttempts(taskId, active)

  if (query.isPending && !query.data) return <LoadingState label="正在读取打印尝试…" />
  if (query.isError && !query.data) {
    return <ErrorState title="打印尝试加载失败" message={query.error.message} onRetry={() => void query.refetch()} />
  }

  const attempts = query.data ?? []
  if (!attempts.length) {
    return <Empty description="该任务还没有产生打印尝试" />
  }

  const columns = [
    { title: '#', dataIndex: 'attemptNo', width: 55 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    { title: '打印机', dataIndex: 'printerId', width: 160, render: (value: string | null | undefined) => value || '—' },
    { title: 'Agent Job', dataIndex: 'agentJobId', width: 150, render: (value: string | null | undefined) => value || '—' },
    {
      title: 'Spooler',
      key: 'spooler',
      width: 170,
      render: (_: unknown, row: PrintAttempt) =>
        row.spoolerJobId != null ? (
          <div><strong>#{row.spoolerJobId}</strong><small className="cell-sub">{row.spoolerStatus || 'UNKNOWN'}</small></div>
        ) : '—',
    },
    {
      title: '时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => <div>{taskTimeAgo(value)}<small className="cell-sub">{formatTaskTime(value)}</small></div>,
    },
    { title: '消息', dataIndex: 'message', render: (value: string | null | undefined) => value || '—' },
  ]

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div className="tab-toolbar">
        <div><strong>打印尝试</strong><span>每次实际执行都应对应独立 Attempt；Spooler 绑定显示真实系统任务。</span></div>
        <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>
      </div>
      <Table<PrintAttempt>
        size="small"
        rowKey="id"
        dataSource={attempts}
        columns={columns}
        pagination={false}
        scroll={{ x: 900 }}
      />
    </Space>
  )
}

function DocumentTab({ taskId, active }: { taskId: string; active: boolean }) {
  const query = usePrintTaskDocument(taskId, active)

  if (query.isPending && !query.data) return <LoadingState label="正在读取冻结文档…" />
  if (query.isError && !query.data) {
    return <ErrorState title="冻结文档加载失败" message={query.error.message} onRetry={() => void query.refetch()} />
  }

  const document = query.data
  if (!document) return null

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="这是任务创建时冻结的正式打印快照"
        description="重试不会重新查询业务数据库，也不会偷偷切换模板版本。"
      />

      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="文档">{document.templateName}</Descriptions.Item>
        <Descriptions.Item label="类型">{document.documentKind} / {document.documentType}</Descriptions.Item>
        <Descriptions.Item label="模板">{document.templateCode}</Descriptions.Item>
        <Descriptions.Item label="版本">{document.templateVersion ? 'v' + document.templateVersion : '—'}</Descriptions.Item>
        <Descriptions.Item label="业务唯一号">{document.businessKey}</Descriptions.Item>
        <Descriptions.Item label="打印机">{document.printerId || '—'}</Descriptions.Item>
        <Descriptions.Item label="份数">{document.copies}</Descriptions.Item>
        <Descriptions.Item label="冻结时间">{formatTaskTime(document.createdAt)}</Descriptions.Item>
        {document.documentKind === 'RAW' && (
          <>
            <Descriptions.Item label="RAW 语言">{document.rawLanguage || '—'}</Descriptions.Item>
            <Descriptions.Item label="字节数">{document.byteLength ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="SHA-256" span={2}><Typography.Text copyable className="mono">{document.sha256 || '—'}</Typography.Text></Descriptions.Item>
          </>
        )}
      </Descriptions>

      {document.documentKind === 'PDF' && document.pdfBase64 && (
        <Button icon={<DownloadOutlined />} onClick={() => downloadPdf(document)}>下载冻结 PDF</Button>
      )}

      {document.documentKind === 'TEMPLATE' && (
        <div className="frozen-json">
          <strong>冻结 renderData</strong>
          <pre>{JSON.stringify(document.renderData ?? {}, null, 2)}</pre>
        </div>
      )}
    </Space>
  )
}

function TaskActions({ task }: { task: PrintTask }) {
  const { message, modal } = App.useApp()
  const mutation = usePrintTaskMutation()
  const [retryOpen, setRetryOpen] = useState(false)
  const [retryPrinter, setRetryPrinter] = useState(task.printerId ?? '')
  const [failOpen, setFailOpen] = useState(false)
  const [failReason, setFailReason] = useState('未收到本地打印完成确认')

  const execute = async (input: Parameters<typeof mutation.mutateAsync>[0], success: string) => {
    try {
      await mutation.mutateAsync(input)
      message.success(success)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务操作失败')
    }
  }

  const queue = () => {
    modal.confirm({
      title: '将任务加入打印队列？',
      content: '只推进平台任务状态，不代表物理打印已经完成。',
      okText: '进入队列',
      onOk: () => execute({ taskId: task.id, action: 'queue' }, '任务已进入队列'),
    })
  }

  const cancel = () => {
    modal.confirm({
      title: '取消打印任务？',
      content: '该操作会把平台任务置为 CANCELLED。正在 PRINTING 的任务不在这里直接取消，避免和真实 Spooler 状态冲突。',
      okText: '确认取消',
      okButtonProps: { danger: true },
      onOk: () => execute({ taskId: task.id, action: 'cancel' }, '任务已取消'),
    })
  }

  return (
    <>
      <Space wrap>
        {canQueue(task) && <Button type="primary" loading={mutation.isPending} onClick={queue}>进入队列</Button>}
        {canRetry(task) && <Button loading={mutation.isPending} onClick={() => { setRetryPrinter(task.printerId ?? ''); setRetryOpen(true) }}>失败重试</Button>}
        {canCancel(task) && <Button danger loading={mutation.isPending} onClick={cancel}>取消任务</Button>}
        {isStalePrinting(task) && <Button danger loading={mutation.isPending} onClick={() => setFailOpen(true)}>标记失败</Button>}
      </Space>

      <Modal
        open={retryOpen}
        title="失败任务重试"
        okText="创建重试"
        confirmLoading={mutation.isPending}
        onCancel={() => setRetryOpen(false)}
        onOk={async () => {
          try {
            await mutation.mutateAsync({
              taskId: task.id,
              action: 'retry',
              printerId: retryPrinter.trim() || task.printerId || undefined,
            })
            setRetryOpen(false)
            message.success('已进入 RETRYING，继续沿用原冻结快照')
          } catch (error) {
            message.error(error instanceof Error ? error.message : '重试失败')
          }
        }}
      >
        <Alert
          type="warning"
          showIcon
          message="重试不会重新生成业务数据"
          description="系统沿用原任务冻结的模板版本和 renderData；这里只允许调整执行打印机。"
        />
        <Input
          style={{ marginTop: 14 }}
          value={retryPrinter}
          onChange={(event) => setRetryPrinter(event.target.value)}
          placeholder="Printer ID；留空则沿用原打印机"
        />
      </Modal>

      <Modal
        open={failOpen}
        title="人工标记打印失败"
        okText="标记失败"
        okButtonProps={{ danger: true }}
        confirmLoading={mutation.isPending}
        onCancel={() => setFailOpen(false)}
        onOk={async () => {
          if (!failReason.trim()) {
            message.warning('请填写失败原因')
            return
          }
          try {
            await mutation.mutateAsync({ taskId: task.id, action: 'fail', reason: failReason })
            setFailOpen(false)
            message.success('任务已标记失败')
          } catch (error) {
            message.error(error instanceof Error ? error.message : '标记失败失败')
          }
        }}
      >
        <Alert
          type="error"
          showIcon
          message="先确认真实打印结果"
          description="错误地把仍在执行的任务标记失败并重试，可能造成重复票据或重复业务单据。"
        />
        <Input.TextArea
          rows={3}
          style={{ marginTop: 14 }}
          value={failReason}
          onChange={(event) => setFailReason(event.target.value)}
        />
      </Modal>
    </>
  )
}

export function PrintTaskDrawer({ taskId, open, tab, onClose, onTabChange }: Props) {
  const queryClient = useQueryClient()
  const taskQuery = usePrintTask(taskId ?? '', open && Boolean(taskId))
  const task = taskQuery.data

  const refresh = async () => {
    if (!taskId) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: printTaskKeys.all }),
      queryClient.invalidateQueries({ queryKey: printTaskKeys.detail(taskId) }),
      queryClient.invalidateQueries({ queryKey: printTaskKeys.attempts(taskId) }),
    ])
  }

  return (
    <Drawer
      open={open}
      width={900}
      onClose={onClose}
      title={task ? (
        <div className="task-drawer-title">
          <div className="task-mark">{taskKindLabel(task.templateCode).slice(0, 1)}</div>
          <div><strong>{task.id}</strong><span>{task.businessKey}</span></div>
        </div>
      ) : '打印任务'}
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>}
    >
      {taskQuery.isPending && <LoadingState label="正在读取打印任务…" />}
      {taskQuery.isError && (
        <ErrorState title="任务详情加载失败" message={taskQuery.error.message} onRetry={() => void taskQuery.refetch()} />
      )}
      {task && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div className="task-status-strip">
            <Tag color={taskStatusColor(task.status)}>{taskStatusLabel[task.status]}</Tag>
            <span>打印机 {task.printerId || '未指定'}</span>
            <span>更新于 {taskTimeAgo(task.updatedAt)}</span>
            <div className="task-strip-spacer" />
            <TaskActions task={task} />
          </div>

          <Tabs
            activeKey={tab}
            onChange={(key) => onTabChange(key as TaskDrawerTab)}
            items={[
              { key: 'overview', label: '概览', children: <OverviewTab task={task} /> },
              { key: 'attempts', label: '打印尝试', children: <AttemptsTab taskId={task.id} active={tab === 'attempts'} /> },
              { key: 'document', label: '冻结文档', children: <DocumentTab taskId={task.id} active={tab === 'document'} /> },
            ]}
          />
        </Space>
      )}
    </Drawer>
  )
}
