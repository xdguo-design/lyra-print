import { describe,expect,it } from 'vitest'
import { localDateTimeToIso,systemLogRelation,systemLogTime } from './system-log-ui'
import type { SystemLogEntry } from '../types'

const base:SystemLogEntry={
  id:1,level:'ERROR',module:'SPOOLER',eventType:'SPOOLER_UNKNOWN',message:'unknown',
  taskId:'PT-001',attemptId:2,agentId:'agent-01',printerId:'label-01',spoolerJobId:173,
  resolved:false,createdAt:'2026-09-22T00:00:00Z',updatedAt:'2026-09-22T00:00:00Z'
}

describe('system log ui helpers',()=>{
  it('builds full correlation text',()=>{
    expect(systemLogRelation(base)).toContain('Task PT-001')
    expect(systemLogRelation(base)).toContain('Attempt #2')
    expect(systemLogRelation(base)).toContain('Agent agent-01')
    expect(systemLogRelation(base)).toContain('Printer label-01')
    expect(systemLogRelation(base)).toContain('Job #173')
  })

  it('returns placeholder when no relation exists',()=>{
    expect(systemLogRelation({...base,taskId:null,attemptId:null,agentId:null,printerId:null,spoolerJobId:null})).toBe('—')
  })

  it('normalizes valid local datetime and rejects invalid values',()=>{
    expect(localDateTimeToIso('2026-09-22T10:30')).toMatch(/^2026-09-22T/)
    expect(localDateTimeToIso('')).toBeUndefined()
    expect(localDateTimeToIso('not-a-date')).toBeUndefined()
  })

  it('formats valid timestamps without throwing',()=>{
    expect(systemLogTime('2026-09-22T00:00:00Z')).not.toBe('—')
    expect(systemLogTime(null)).toBe('—')
  })
})
