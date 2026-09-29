import { z } from 'zod'
import { apiClient } from '@/shared/api/client'
import {
  agentHeartbeatSchema,
  agentInstanceSchema,
  agentPrinterSchema,
  type AgentHeartbeat,
  type AgentInstance,
  type AgentPrinter,
} from '@/features/print-nodes/model'

export async function listPrintNodes(): Promise<AgentInstance[]> {
  const response = await apiClient.get('/agents')
  return z.array(agentInstanceSchema).parse(response.data)
}

export async function listNodePrinters(
  agentId: string,
  instanceId: string,
): Promise<AgentPrinter[]> {
  const response = await apiClient.get(
    '/agents/' + encodeURIComponent(agentId) + '/instances/' + encodeURIComponent(instanceId) + '/printers',
  )
  return z.array(agentPrinterSchema).parse(response.data)
}

export async function listNodeHeartbeats(
  agentId: string,
  instanceId: string,
  limit = 120,
): Promise<AgentHeartbeat[]> {
  const response = await apiClient.get(
    '/agents/' + encodeURIComponent(agentId) + '/instances/' + encodeURIComponent(instanceId) + '/heartbeats',
    { params: { limit } },
  )
  return z.array(agentHeartbeatSchema).parse(response.data)
}
