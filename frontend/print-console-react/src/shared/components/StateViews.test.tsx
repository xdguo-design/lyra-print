import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState, ErrorState, StatusBadge } from '@/shared/components/StateViews'

describe('shared state views', () => {
  it('renders semantic status text', () => {
    render(<StatusBadge label="在线" tone="success" />)
    expect(screen.getByText('在线')).toBeInTheDocument()
  })

  it('renders business-specific empty copy', () => {
    render(<EmptyState title="尚未检测到打印机" description="请检查节点打印环境。" />)
    expect(screen.getByText('尚未检测到打印机')).toBeInTheDocument()
    expect(screen.getByText('请检查节点打印环境。')).toBeInTheDocument()
  })

  it('supports retry from error state', () => {
    const retry = vi.fn()
    render(<ErrorState message="打印机明细加载失败" onRetry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
