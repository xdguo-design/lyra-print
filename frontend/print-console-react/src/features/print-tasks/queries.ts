import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getPrintTask,
  getPrintTaskDocument,
  getPrintTaskSummary,
  listPrintTaskAttempts,
  listPrintTasks,
  mutatePrintTask,
} from '@/features/print-tasks/api'
import type { PrintTaskFilters, TaskMutation } from '@/features/print-tasks/model'

export const printTaskKeys = {
  all: ['print-tasks'] as const,
  list: (filters: PrintTaskFilters) => ['print-tasks', 'list', filters] as const,
  summary: ['print-tasks', 'summary'] as const,
  detail: (taskId: string) => ['print-tasks', taskId] as const,
  document: (taskId: string) => ['print-tasks', taskId, 'document'] as const,
  attempts: (taskId: string) => ['print-tasks', taskId, 'attempts'] as const,
}

export function usePrintTasks(filters: PrintTaskFilters) {
  return useQuery({
    queryKey: printTaskKeys.list(filters),
    queryFn: () => listPrintTasks(filters),
    refetchInterval: 5_000,
  })
}

export function usePrintTaskSummary() {
  return useQuery({
    queryKey: printTaskKeys.summary,
    queryFn: getPrintTaskSummary,
    refetchInterval: 5_000,
  })
}

export function usePrintTask(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: printTaskKeys.detail(taskId),
    queryFn: () => getPrintTask(taskId),
    enabled,
  })
}

export function usePrintTaskDocument(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: printTaskKeys.document(taskId),
    queryFn: () => getPrintTaskDocument(taskId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function usePrintTaskAttempts(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: printTaskKeys.attempts(taskId),
    queryFn: () => listPrintTaskAttempts(taskId),
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  })
}

export function usePrintTaskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TaskMutation) => mutatePrintTask(input),
    onSuccess: (task) => {
      queryClient.setQueryData(printTaskKeys.detail(task.id), task)
      void queryClient.invalidateQueries({ queryKey: printTaskKeys.all })
    },
  })
}
