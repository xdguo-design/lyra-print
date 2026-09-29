import { z } from 'zod'

export const printTaskStatusSchema = z.enum([
  'CREATED',
  'QUEUED',
  'PRINTING',
  'SUCCESS',
  'FAILED',
  'RETRYING',
  'WAITING_AGENT',
  'CANCELLED',
])

export const printTaskSchema = z.object({
  id: z.string(),
  templateCode: z.string(),
  templateVersion: z.number().int().nullable().optional(),
  businessKey: z.string(),
  snapshotId: z.string(),
  printerId: z.string().nullable().optional(),
  copies: z.number().int(),
  status: printTaskStatusSchema,
  attempts: z.number().int(),
  message: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const printTaskSummarySchema = z.object({
  total: z.number().int(),
  created: z.number().int(),
  queued: z.number().int(),
  printing: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  retrying: z.number().int(),
  waitingAgent: z.number().int(),
  cancelled: z.number().int(),
  active: z.number().int(),
})

export const printAttemptSchema = z.object({
  id: z.number().int(),
  taskId: z.string(),
  attemptNo: z.number().int(),
  printerId: z.string().nullable().optional(),
  status: z.string(),
  message: z.string().nullable().optional(),
  agentJobId: z.string().nullable().optional(),
  spoolerJobId: z.number().int().nullable().optional(),
  spoolerDocumentName: z.string().nullable().optional(),
  spoolerStatus: z.string().nullable().optional(),
  spoolerBoundAt: z.string().nullable().optional(),
  spoolerLastObservedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const printTaskDocumentSchema = z.object({
  taskId: z.string(),
  templateCode: z.string(),
  templateVersion: z.number().int().nullable().optional(),
  templateName: z.string(),
  documentType: z.enum([
    'FORM',
    'INVOICE',
    'RECEIPT',
    'EXPENSE_LIST',
    'POS_RECEIPT',
    'LABEL',
    'REPORT',
    'PDF',
    'RAW',
  ]),
  documentKind: z.enum(['TEMPLATE', 'PDF', 'RAW']),
  businessKey: z.string(),
  printerId: z.string().nullable().optional(),
  copies: z.number().int(),
  design: z.unknown().nullable().optional(),
  renderData: z.record(z.string(), z.unknown()).nullable().optional(),
  pdfBase64: z.string().nullable().optional(),
  rawLanguage: z.enum(['ESC_POS', 'ZPL', 'TSPL', 'CPCL']).nullable().optional(),
  rawBase64: z.string().nullable().optional(),
  byteLength: z.number().int().nullable().optional(),
  sha256: z.string().nullable().optional(),
  createdAt: z.string(),
})

export type PrintTaskStatus = z.infer<typeof printTaskStatusSchema>
export type PrintTask = z.infer<typeof printTaskSchema>
export type PrintTaskSummary = z.infer<typeof printTaskSummarySchema>
export type PrintAttempt = z.infer<typeof printAttemptSchema>
export type PrintTaskDocument = z.infer<typeof printTaskDocumentSchema>

export interface PrintTaskFilters {
  status: PrintTaskStatus | undefined
  templateCode: string | undefined
  printerId: string | undefined
  keyword: string | undefined
  limit: number
}

export type TaskMutation =
  | { taskId: string; action: 'queue' | 'cancel' }
  | { taskId: string; action: 'retry'; printerId: string | undefined }
  | { taskId: string; action: 'fail'; reason: string }
