import { describe,expect,it } from 'vitest'
import type { DataSourceConnection,TemplateDataConfig } from './types'
import { parseJsonObject,validateDataConfig } from './template-data-ui'

const connection:DataSourceConnection={
  id:'DS-READ',name:'只读库',dbType:'SQLITE',jdbcUrl:'jdbc:sqlite:test.db',
  readOnly:true,enabled:true,createdAt:'2026-09-21T00:00:00Z',updatedAt:'2026-09-21T00:00:00Z'
}

function sqlConfig():TemplateDataConfig{
  return {
    schemaVersion:1,
    mode:'SQL',
    queries:[{
      queryId:'order-header',
      name:'订单头',
      connectionId:connection.id,
      sql:'SELECT name,total FROM orders WHERE id=:orderId',
      params:[{name:'orderId',type:'STRING',required:true}],
      resultKey:'order',
      resultType:'OBJECT',
      order:10,
      enabled:true,
      timeoutMs:5000,
      maxRows:100
    }]
  }
}

describe('template data UI validation',()=>{
  it('accepts a complete SQL config',()=>{
    expect(validateDataConfig(sqlConfig(),[connection]).filter(x=>x.level==='error')).toEqual([])
  })

  it('locates query and parameter errors before a server request',()=>{
    const config=sqlConfig()
    config.queries[0].connectionId='missing'
    config.queries[0].sql='SELECT * FROM orders WHERE id=:missingParam'
    config.queries[0].params[0].defaultValue=123

    const issues=validateDataConfig(config,[connection])
    expect(issues.some(x=>x.code==='CONNECTION_NOT_FOUND'&&x.queryId==='order-header')).toBe(true)
    expect(issues.some(x=>x.code==='PARAM_UNDEFINED'&&x.paramName==='missingParam')).toBe(true)
    expect(issues.some(x=>x.code==='PARAM_DEFAULT_INVALID'&&x.paramName==='orderId')).toBe(true)
  })

  it('blocks JSON mode when retained SQL queries are still enabled',()=>{
    const config=sqlConfig()
    config.mode='JSON'
    expect(validateDataConfig(config,[connection]).some(x=>x.code==='JSON_ENABLED_QUERY')).toBe(true)
  })

  it('parses only object-shaped test params',()=>{
    expect(parseJsonObject('{"patientNo":"P001"}').value).toEqual({patientNo:'P001'})
    expect(parseJsonObject('[1,2,3]').error).toContain('JSON 对象')
    expect(parseJsonObject('{bad').error).toContain('JSON 格式错误')
  })
})
