import { Badge, Button, Empty, Result, Spin } from 'antd'
import type { ReactNode } from 'react'

export function LoadingState({ label = '正在加载…' }: { label?: string }) {
  return (
    <div className="state-panel" role="status">
      <Spin size="large" />
      <strong>{label}</strong>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="state-panel">
      <Empty description={title} />
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({
  title = '加载失败',
  message,
  onRetry,
}: {
  title?: string
  message: string
  onRetry?: () => void
}) {
  return (
    <Result
      status="error"
      title={title}
      subTitle={message}
      extra={onRetry ? <Button onClick={onRetry}>重试</Button> : undefined}
    />
  )
}

type StatusTone = 'success' | 'processing' | 'warning' | 'error' | 'default'

export function StatusBadge({ label, tone = 'default' }: { label: string; tone?: StatusTone }) {
  return <Badge status={tone} text={label} />
}
