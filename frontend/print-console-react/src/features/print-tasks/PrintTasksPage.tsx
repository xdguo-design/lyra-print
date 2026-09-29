import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Col, Input, Row, Select, Space, Table, Tag } from 'antd'
import type { TableProps } from 'antd'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PrintTaskDrawer, type TaskDrawerTab } from '@/features/print-tasks/PrintTaskDrawer'
import { printTaskStatusSchema, type PrintTask, type PrintTaskFilters, type PrintTaskStatus } from '@/features/print-tasks/model'
import { usePrintTaskSummary, usePrintTasks } from '@/features/print-tasks/queries'
import {
  formatTaskTime,
  isStalePrinting,
  taskKindLabel,
  taskStatusColor,
  taskStatusLabel,
  taskTimeAgo,
} from '@/features/print-tasks/status'
import { ErrorState } from '@/shared/components/StateViews'
import { PageHeader } from '@/shared/components/PageHeader'
import './print-tasks.css'

const statusOptions = printTaskStatusSchema.options

function statusFromParam(value: string | null): PrintTaskStatus | undefined {
  if (!value) return undefined
  const parsed = printTaskStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function PrintTasksPage() {
  const [params, setParams] = useSearchParams()
  const status = statusFromParam(params.get('status'))
  const templateCode = params.get('template')?.trim() || undefined
  const printerId = params.get('printer')?.trim() || undefined
  const keyword = params.get('q')?.trim() || undefined
  const taskId = params.get('task')?.trim() || undefined
  const tabParam = params.get('tab')
  const tab: TaskDrawerTab = ['overview', 'attempts', 'document'].includes(tabParam ?? '')
    ? (tabParam as TaskDrawerTab)
    : 'overview'

  const filters: PrintTaskFilters = useMemo(
    () => ({ status, templateCode, printerId, keyword, limit: 200 }),
    [status, templateCode, printerId, keyword],
  )

  const taskQuery = usePrintTasks(filters)
  const summaryQuery = usePrintTaskSummary()
  const rows = taskQuery.data ?? []
  const summary = summaryQuery.data

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params)
    if (!value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const templateOptions = useMemo(
    () => [...new Set(rows.map((row) => row.templateCode))].sort(),
    [rows],
  )
  const printerOptions = useMemo(
    () => [...new Set(rows.map((row) => row.printerId).filter((value): value is string => Boolean(value)))].sort(),
    [rows],
  )
  const stalePrinting = useMemo(() => rows.filter((row) => isStalePrinting(row)).length, [rows])

  const openTask = (task: PrintTask) => {
    const next = new URLSearchParams(params)
    next.set('task', task.id)
    next.set('tab', 'overview')
    setParams(next, { replace: true })
  }

  const closeTask = () => {
    const next = new URLSearchParams(params)
    next.delete('task')
    next.delete('tab')
    setParams(next, { replace: true })
  }

  const columns: TableProps<PrintTask>['columns'] = [
    {
      title: '任务',
      key: 'task',
      width: 245,
      fixed: 'left',
      render: (_, task) => (
        <button className="task-link" onClick={() => openTask(task)}>
          <span className="task-kind-mark">{taskKindLabel(task.templateCode).slice(0, 1)}</span>
          <span>
            <strong className="mono">{task.id}</strong>
            <small>{task.businessKey}</small>
          </span>
        </button>
      ),
    },
    {
      title: '类型 / 模板',
      width: 180,
      render: (_, task) => (
        <div>
          <Tag>{taskKindLabel(task.templateCode)}</Tag>
          <strong>{task.templateCode}</strong>
          <small className="cell-sub">{task.templateVersion ? 'v' + task.templateVersion : '无模板版本'}</small>
        </div>
      ),
    },
    {
      title: '状态',
      width: 120,
      render: (_, task) => (
        <div>
          <Tag color={taskStatusColor(task.status)}>{taskStatusLabel[task.status]}</Tag>
          {isStalePrinting(task) && <small className="cell-sub danger-text">超过 2 分钟未更新</small>}
        </div>
      ),
    },
    {
      title: '打印机',
      dataIndex: 'printerId',
      width: 180,
      render: (value: string | null | undefined) => value || '未指定',
    },
    {
      title: '份数',
      dataIndex: 'copies',
      width: 70,
    },
    {
      title: '尝试',
      dataIndex: 'attempts',
      width: 70,
    },
    {
      title: '消息',
      dataIndex: 'message',
      ellipsis: true,
      width: 250,
      render: (value: string | null | undefined) => value || '—',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 185,
      render: (value: string) => (
        <div>
          <strong>{taskTimeAgo(value)}</strong>
          <small className="cell-sub">{formatTaskTime(value)}</small>
        </div>
      ),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 90,
      render: (_, task) => <Button size="small" onClick={() => openTask(task)}>详情</Button>,
    },
  ]

  if (taskQuery.isError && !taskQuery.data) {
    return (
      <ErrorState
        title="打印任务加载失败"
        message={taskQuery.error.message}
        onRetry={() => void taskQuery.refetch()}
      />
    )
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        eyebrow="PRINT TASK · CONTROL PLANE"
        title="打印任务"
        description="查看正式打印任务的状态、冻结文档、打印尝试与 Spooler 绑定。管理动作严格遵循服务端状态机，不把“已提交”误当成“已打印成功”。"
        actions={
          <Button
            icon={<ReloadOutlined />}
            loading={taskQuery.isFetching || summaryQuery.isFetching}
            onClick={() => {
              void taskQuery.refetch()
              void summaryQuery.refetch()
            }}
          >
            刷新
          </Button>
        }
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} md={12} xl={5}>
          <Card className="task-metric"><span>任务总数</span><strong>{summary?.total ?? 0}</strong><small>当前平台正式任务</small></Card>
        </Col>
        <Col xs={24} md={12} xl={5}>
          <Card className="task-metric primary"><span>活跃任务</span><strong>{summary?.active ?? 0}</strong><small>创建 / 排队 / 打印 / 等待</small></Card>
        </Col>
        <Col xs={24} md={12} xl={5}>
          <Card className="task-metric"><span>成功</span><strong>{summary?.succeeded ?? 0}</strong><small>已进入终态 SUCCESS</small></Card>
        </Col>
        <Col xs={24} md={12} xl={5}>
          <Card className="task-metric danger"><span>失败</span><strong>{summary?.failed ?? 0}</strong><small>{summary?.retrying ?? 0} 个待重试</small></Card>
        </Col>
        <Col xs={24} md={12} xl={4}>
          <Card className={stalePrinting ? 'task-metric warning' : 'task-metric'}>
            <span>长时打印</span><strong>{stalePrinting}</strong><small>PRINTING 超过 2 分钟</small>
          </Card>
        </Col>
      </Row>

      <Card className="task-filter-card">
        <Space wrap size={10}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={params.get('q') ?? ''}
            placeholder="任务号、业务唯一号等"
            style={{ width: 280 }}
            onChange={(event) => setParam('q', event.target.value.trimStart() || undefined)}
          />
          <Select
            allowClear
            placeholder="全部状态"
            value={status}
            style={{ width: 145 }}
            onChange={(value) => setParam('status', value)}
            options={statusOptions.map((value) => ({ value, label: taskStatusLabel[value] }))}
          />
          <Select
            allowClear
            showSearch
            placeholder="全部模板"
            value={templateCode}
            style={{ width: 180 }}
            onChange={(value) => setParam('template', value)}
            options={templateOptions.map((value) => ({ value, label: value }))}
          />
          <Select
            allowClear
            showSearch
            placeholder="全部打印机"
            value={printerId}
            style={{ width: 200 }}
            onChange={(value) => setParam('printer', value)}
            options={printerOptions.map((value) => ({ value, label: value }))}
          />
          <Button
            onClick={() => {
              const next = new URLSearchParams(params)
              ;['q', 'status', 'template', 'printer'].forEach((key) => next.delete(key))
              setParams(next, { replace: true })
            }}
          >
            重置
          </Button>
        </Space>
        <div className="task-filter-summary">
          当前显示 <strong>{rows.length}</strong> 条，后台每 5 秒无感刷新。
        </div>
      </Card>

      <Card className="task-table-card" styles={{ body: { padding: 0 } }}>
        <Table<PrintTask>
          rowKey="id"
          loading={taskQuery.isPending}
          dataSource={rows}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1450 }}
        />
      </Card>

      <PrintTaskDrawer
        taskId={taskId}
        open={Boolean(taskId)}
        tab={tab}
        onClose={closeTask}
        onTabChange={(nextTab) => setParam('tab', nextTab)}
      />
    </Space>
  )
}
