import { describe, expect, it } from 'vitest'
import type { PrintTask } from '@/features/print-tasks/model'
import { canCancel, canQueue, canRetry, isStalePrinting } from '@/features/print-tasks/status'

function task(status: PrintTask['status'], updatedAt = '2026-09-23T00:00:00Z'): PrintTask {
  return {
    id: 'PT-1',
    templateCode: 'T-1',
    businessKey: 'B-1',
    snapshotId: 'S-1',
    copies: 1,
    status,
    attempts: 0,
    createdAt: '2026-09-23T00:00:00Z',
    updatedAt,
  }
}

describe('print task management actions', () => {
  it('only queues states accepted by the backend state machine', () => {
    expect(canQueue(task('CREATED'))).toBe(true)
    expect(canQueue(task('RETRYING'))).toBe(true)
    expect(canQueue(task('WAITING_AGENT'))).toBe(true)
    expect(canQueue(task('QUEUED'))).toBe(false)
  })

  it('only retries failed tasks', () => {
    expect(canRetry(task('FAILED'))).toBe(true)
    expect(canRetry(task('SUCCESS'))).toBe(false)
  })

  it('does not expose direct cancel while printing', () => {
    expect(canCancel(task('PRINTING'))).toBe(false)
    expect(canCancel(task('QUEUED'))).toBe(true)
  })

  it('detects printing tasks unchanged for over two minutes', () => {
    const updatedAt = '2026-09-23T00:00:00Z'
    expect(isStalePrinting(task('PRINTING', updatedAt), new Date('2026-09-23T00:03:00Z').getTime())).toBe(true)
  })
})
