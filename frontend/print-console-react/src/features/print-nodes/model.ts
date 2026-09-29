import { z } from 'zod'

export const agentInstanceSchema = z.object({
  agentId: z.string(),
  instanceId: z.string(),
  hostName: z.string(),
  ipAddress: z.string().nullable().optional(),
  osName: z.string(),
  agentVersion: z.string(),
  status: z.enum(['ONLINE', 'UNKNOWN', 'OFFLINE']),
  cpuUsage: z.number().nullable().optional(),
  memoryUsage: z.number().nullable().optional(),
  activeJobs: z.number().int(),
  queuedJobs: z.number().int(),
  printerCount: z.number().int(),
  spoolerStatus: z.string().nullable().optional(),
  registeredAt: z.string(),
  lastHeartbeatAt: z.string(),
  updatedAt: z.string(),
})

export const agentPrinterSchema = z.object({
  agentId: z.string(),
  instanceId: z.string(),
  printerId: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  defaultPrinter: z.boolean(),
  driverName: z.string().nullable().optional(),
  portName: z.string().nullable().optional(),
  shared: z.boolean(),
  shareName: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  paperSizes: z.array(z.string()),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
})

export const agentHeartbeatSchema = z.object({
  id: z.number().int(),
  agentId: z.string(),
  instanceId: z.string(),
  cpuUsage: z.number().nullable().optional(),
  memoryUsage: z.number().nullable().optional(),
  activeJobs: z.number().int(),
  queuedJobs: z.number().int(),
  printerCount: z.number().int(),
  spoolerStatus: z.string().nullable().optional(),
  agentVersion: z.string().nullable().optional(),
  createdAt: z.string(),
})

export type AgentInstance = z.infer<typeof agentInstanceSchema>
export type AgentPrinter = z.infer<typeof agentPrinterSchema>
export type AgentHeartbeat = z.infer<typeof agentHeartbeatSchema>
export type NodeState = 'ONLINE' | 'BUSY' | 'DEGRADED' | 'OFFLINE'
export type PrintHealth = 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNBOUND'
