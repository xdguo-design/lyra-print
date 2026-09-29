import { useQuery } from '@tanstack/react-query'
import { listNodeHeartbeats, listNodePrinters, listPrintNodes } from '@/features/print-nodes/api'

export const printNodeKeys = {
  all: ['print-nodes'] as const,
  printers: (agentId: string, instanceId: string) =>
    ['print-nodes', agentId, instanceId, 'printers'] as const,
  heartbeats: (agentId: string, instanceId: string) =>
    ['print-nodes', agentId, instanceId, 'heartbeats'] as const,
}

export function usePrintNodes() {
  return useQuery({
    queryKey: printNodeKeys.all,
    queryFn: listPrintNodes,
    refetchInterval: 30_000,
  })
}

export function useNodePrinters(agentId: string, instanceId: string, enabled: boolean) {
  return useQuery({
    queryKey: printNodeKeys.printers(agentId, instanceId),
    queryFn: () => listNodePrinters(agentId, instanceId),
    enabled,
    staleTime: 30_000,
  })
}

export function useNodeHeartbeats(agentId: string, instanceId: string, enabled: boolean) {
  return useQuery({
    queryKey: printNodeKeys.heartbeats(agentId, instanceId),
    queryFn: () => listNodeHeartbeats(agentId, instanceId),
    enabled,
    staleTime: 30_000,
  })
}
