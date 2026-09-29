import type { PrintTask, PrintTaskStatus } from '@/features/print-tasks/model'

export const taskStatusLabel: Record<PrintTaskStatus, string> = {
  CREATED: '已创建',
  QUEUED: '排队中',
  PRINTING: '打印中',
  SUCCESS: '成功',
  FAILED: '失败',
  RETRYING: '待重试',
  WAITING_AGENT: '等待节点',
  CANCELLED: '已取消',
}

export function taskStatusColor(status: PrintTaskStatus) {
  const colors: Record<PrintTaskStatus, string> = {
    CREATED: 'default',
    QUEUED: 'blue',
    PRINTING: 'processing',
    SUCCESS: 'green',
    FAILED: 'red',
    RETRYING: 'orange',
    WAITING_AGENT: 'gold',
    CANCELLED: 'default',
  }
  return colors[status]
}

export function canQueue(task: PrintTask) {
  return ['CREATED', 'RETRYING', 'WAITING_AGENT'].includes(task.status)
}

export function canRetry(task: PrintTask) {
  return task.status === 'FAILED'
}

export function canCancel(task: PrintTask) {
  return ['CREATED', 'QUEUED', 'WAITING_AGENT'].includes(task.status)
}

export function isStalePrinting(task: PrintTask, now = Date.now()) {
  if (task.status !== 'PRINTING') return false
  const updated = new Date(task.updatedAt).getTime()
  return Number.isFinite(updated) && now - updated > 120_000
}

export function taskKindLabel(templateCode: string) {
  if (templateCode === '__PDF__') return 'PDF'
  if (templateCode === '__RAW__') return 'RAW'
  return '模板'
}

export function formatTaskTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

export function taskTimeAgo(value?: string | null) {
  if (!value) return '—'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return value
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return seconds + ' 秒前'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes + ' 分钟前'
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? hours + ' 小时前' : Math.floor(hours / 24) + ' 天前'
}
