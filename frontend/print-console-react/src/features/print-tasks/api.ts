import { z } from 'zod'
import { apiClient } from '@/shared/api/client'
import {
  printAttemptSchema,
  printTaskDocumentSchema,
  printTaskSchema,
  printTaskSummarySchema,
  type PrintAttempt,
  type PrintTask,
  type PrintTaskDocument,
  type PrintTaskFilters,
  type PrintTaskSummary,
  type TaskMutation,
} from '@/features/print-tasks/model'

export async function listPrintTasks(filters: PrintTaskFilters): Promise<PrintTask[]> {
  const response = await apiClient.get('/print-tasks', {
    params: {
      status: filters.status,
      templateCode: filters.templateCode,
      printerId: filters.printerId,
      keyword: filters.keyword,
      limit: filters.limit,
    },
  })
  return z.array(printTaskSchema).parse(response.data)
}

export async function getPrintTaskSummary(): Promise<PrintTaskSummary> {
  const response = await apiClient.get('/print-tasks/summary')
  return printTaskSummarySchema.parse(response.data)
}

export async function getPrintTask(taskId: string): Promise<PrintTask> {
  const response = await apiClient.get('/print-tasks/' + encodeURIComponent(taskId))
  return printTaskSchema.parse(response.data)
}

export async function getPrintTaskDocument(taskId: string): Promise<PrintTaskDocument> {
  const response = await apiClient.get(
    '/print-tasks/' + encodeURIComponent(taskId) + '/document',
  )
  return printTaskDocumentSchema.parse(response.data)
}

export async function listPrintTaskAttempts(taskId: string): Promise<PrintAttempt[]> {
  const response = await apiClient.get(
    '/print-tasks/' + encodeURIComponent(taskId) + '/attempts',
  )
  return z.array(printAttemptSchema).parse(response.data)
}

export async function mutatePrintTask(input: TaskMutation): Promise<PrintTask> {
  const taskPath = '/print-tasks/' + encodeURIComponent(input.taskId)

  if (input.action === 'retry') {
    const response = await apiClient.post(taskPath + '/retry', {
      ...(input.printerId?.trim() ? { printerId: input.printerId.trim() } : {}),
    })
    return printTaskSchema.parse(response.data)
  }

  if (input.action === 'fail') {
    const response = await apiClient.post(taskPath + '/fail', { reason: input.reason.trim() })
    return printTaskSchema.parse(response.data)
  }

  const response = await apiClient.post(taskPath + '/' + input.action)
  return printTaskSchema.parse(response.data)
}
