import type { AgentInstance, NodeState, PrintHealth } from '@/features/print-nodes/model'

export function spoolerHealthy(value?: string | null) {
  return ['RUNNING', 'UNSUPPORTED'].includes((value ?? 'UNKNOWN').toUpperCase())
}

export function printHealth(node: AgentInstance): PrintHealth {
  if (node.status === 'OFFLINE') return 'OFFLINE'
  if (node.status === 'UNKNOWN') return 'DEGRADED'
  if (node.printerCount <= 0) return 'UNBOUND'
  if (!spoolerHealthy(node.spoolerStatus)) return 'DEGRADED'
  return 'HEALTHY'
}

export function nodeState(node: AgentInstance): NodeState {
  if (node.status === 'OFFLINE') return 'OFFLINE'
  if (node.status === 'UNKNOWN') return 'DEGRADED'
  if (node.activeJobs > 0) return 'BUSY'
  return 'ONLINE'
}

export const nodeStateLabel: Record<NodeState, string> = {
  ONLINE: '在线',
  BUSY: '忙碌',
  DEGRADED: '异常',
  OFFLINE: '离线',
}

export const healthLabel: Record<PrintHealth, string> = {
  HEALTHY: '打印链路正常',
  DEGRADED: '打印链路异常',
  OFFLINE: '节点离线',
  UNBOUND: '未发现打印机',
}

export function shortOs(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes('win')) return 'Windows'
  if (normalized.includes('darwin') || normalized.includes('mac')) return 'macOS'
  if (normalized.includes('linux')) return 'Linux'
  return value.split(' ')[0] || '未知系统'
}

export function formatTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

export function timeAgo(value?: string | null) {
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

export function percent(value?: number | null) {
  return value == null ? '—' : value.toFixed(1) + '%'
}
