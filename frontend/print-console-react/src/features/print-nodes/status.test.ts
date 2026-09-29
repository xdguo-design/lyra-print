import { describe, expect, it } from 'vitest'
import { nodeState, printHealth } from '@/features/print-nodes/status'
import type { AgentInstance } from '@/features/print-nodes/model'

function node(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    agentId: 'a',
    instanceId: 'i',
    hostName: 'host',
    osName: 'Windows 11',
    agentVersion: '1.0.0',
    status: 'ONLINE',
    activeJobs: 0,
    queuedJobs: 0,
    printerCount: 1,
    spoolerStatus: 'RUNNING',
    registeredAt: '2026-09-23T00:00:00Z',
    lastHeartbeatAt: '2026-09-23T00:00:00Z',
    updatedAt: '2026-09-23T00:00:00Z',
    ...overrides,
  }
}

describe('print node status', () => {
  it('keeps node connectivity separate from print health', () => {
    const value = node({ spoolerStatus: 'STOPPED' })
    expect(nodeState(value)).toBe('ONLINE')
    expect(printHealth(value)).toBe('DEGRADED')
  })

  it('marks active online node busy', () => {
    expect(nodeState(node({ activeJobs: 2 }))).toBe('BUSY')
  })

  it('marks online node without printers unbound', () => {
    expect(printHealth(node({ printerCount: 0 }))).toBe('UNBOUND')
  })
})
