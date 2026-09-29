import type { SystemLogEntry,SystemLogLevel } from '../types'

export const systemLogLevelText:Record<SystemLogLevel,string>={
  DEBUG:'调试',INFO:'信息',WARN:'警告',ERROR:'错误',FATAL:'严重'
}

export const systemLogLevelColor:Record<SystemLogLevel,string>={
  DEBUG:'default',INFO:'blue',WARN:'orange',ERROR:'red',FATAL:'magenta'
}

export function systemLogRelation(log:SystemLogEntry):string{
  const parts:string[]=[]
  if(log.taskId)parts.push('Task '+log.taskId)
  if(log.attemptId!=null)parts.push('Attempt #'+log.attemptId)
  if(log.agentId)parts.push('Agent '+log.agentId)
  if(log.printerId)parts.push('Printer '+log.printerId)
  if(log.spoolerJobId!=null)parts.push('Job #'+log.spoolerJobId)
  return parts.join(' · ')||'—'
}

export function systemLogTime(value?:string|null):string{
  if(!value)return '—'
  const date=new Date(value)
  return Number.isFinite(date.getTime())?date.toLocaleString():value
}

export function localDateTimeToIso(value:string):string|undefined{
  if(!value.trim())return undefined
  const date=new Date(value)
  return Number.isFinite(date.getTime())?date.toISOString():undefined
}
