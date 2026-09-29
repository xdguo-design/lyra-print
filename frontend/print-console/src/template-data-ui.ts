import axios from 'axios'
import type { DataSourceConnection,TemplateDataConfig,TemplateQueryConfig,TemplateQueryParam } from './types'

export interface UiProblem {
  code:string
  message:string
  queryId?:string
  testRunId?:string
}

export interface DataConfigIssue {
  level:'error'|'warning'
  code:string
  message:string
  queryId?:string
  paramName?:string
}

const QUERY_ID=/^[a-z][a-z0-9-]{1,63}$/
const KEY=/^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const RESERVED=new Set(['__proto__','prototype','constructor'])
const PARAM_TYPES=new Set(['STRING','INTEGER','DECIMAL','BOOLEAN','DATE','DATETIME'])
const RESULT_TYPES=new Set(['OBJECT','ARRAY','SCALAR'])

export function apiProblem(error:unknown,fallback='操作失败'):UiProblem{
  if(axios.isAxiosError(error)){
    const data=error.response?.data as Record<string,unknown>|undefined
    return {
      code:String(data?.code||('HTTP_'+(error.response?.status||'ERROR'))),
      message:String(data?.detail||data?.message||error.message||fallback),
      queryId:data?.queryId?String(data.queryId):undefined,
      testRunId:data?.testRunId?String(data.testRunId):undefined
    }
  }
  const value=error as {message?:string}|null
  return {code:'CLIENT_ERROR',message:value?.message||fallback}
}

export function parseJsonObject(text:string):{value?:Record<string,unknown>;error?:string}{
  try{
    const value=JSON.parse(text||'{}')
    if(!value||Array.isArray(value)||typeof value!=='object')return {error:'必须是 JSON 对象，例如 {"patientNo":"P001"}'}
    return {value}
  }catch(e:any){
    return {error:'JSON 格式错误'+(e?.message?': '+e.message:'')}
  }
}

export function validateDataConfig(config:TemplateDataConfig,connections:DataSourceConnection[]):DataConfigIssue[]{
  const issues:DataConfigIssue[]=[]
  if(config.schemaVersion!==1)issues.push(error('SCHEMA_VERSION','schemaVersion 当前只支持 1'))
  if(!Array.isArray(config.queries)){
    issues.push(error('QUERIES_REQUIRED','queries 必须是数组'))
    return issues
  }
  const connectionMap=new Map(connections.map(c=>[c.id,c]))
  const queryIds=new Set<string>(),resultKeys=new Set<string>()
  let enabled=0

  config.queries.forEach((query,index)=>{
    const label=query.queryId||('第 '+(index+1)+' 条查询')
    if(!QUERY_ID.test(query.queryId||''))issues.push(error('QUERY_ID_INVALID',label+'：queryId 需以小写字母开头，仅含小写字母、数字和 -，长度 2~64',query.queryId))
    else if(queryIds.has(query.queryId))issues.push(error('QUERY_ID_DUPLICATE','queryId 重复：'+query.queryId,query.queryId))
    else queryIds.add(query.queryId)

    if(!query.name?.trim())issues.push(error('QUERY_NAME_REQUIRED',label+'：请输入查询名称',query.queryId))
    if(query.enabled)enabled++

    if(!query.connectionId)issues.push(error('CONNECTION_REQUIRED',label+'：请选择数据连接',query.queryId))
    else{
      const connection=connectionMap.get(query.connectionId)
      if(!connection)issues.push(error('CONNECTION_NOT_FOUND',label+'：数据连接不存在或尚未加载',query.queryId))
      else{
        if(!connection.enabled)issues.push(error('CONNECTION_DISABLED',label+'：数据连接已停用',query.queryId))
        if(!connection.readOnly)issues.push(error('CONNECTION_NOT_READ_ONLY',label+'：只能使用只读数据连接',query.queryId))
      }
    }

    if(!query.sql?.trim())issues.push(error('SQL_REQUIRED',label+'：请输入只读 SQL',query.queryId))
    else if(!/^\s*(select|with)\b/i.test(stripLeadingComments(query.sql)))issues.push(error('SQL_READ_ONLY',label+'：SQL 必须以 SELECT 或 WITH 开始',query.queryId))

    if(!KEY.test(query.resultKey||'')||RESERVED.has(query.resultKey))issues.push(error('RESULT_KEY_INVALID',label+'：resultKey 格式非法',query.queryId))
    else if(resultKeys.has(query.resultKey))issues.push(error('RESULT_KEY_DUPLICATE','resultKey 重复：'+query.resultKey,query.queryId))
    else resultKeys.add(query.resultKey)

    if(!RESULT_TYPES.has(query.resultType))issues.push(error('RESULT_TYPE_INVALID',label+'：resultType 非法',query.queryId))
    if(query.timeoutMs!==undefined&&(query.timeoutMs<100||query.timeoutMs>30000))issues.push(error('TIMEOUT_RANGE',label+'：timeoutMs 必须在 100~30000 之间',query.queryId))
    if(query.maxRows!==undefined&&(query.maxRows<1||query.maxRows>10000))issues.push(error('MAX_ROWS_RANGE',label+'：maxRows 必须在 1~10000 之间',query.queryId))

    validateParams(query,issues)
  })

  if(config.mode==='SQL'&&!config.queries.length)issues.push(error('QUERY_REQUIRED','SQL 模式至少需要一条查询'))
  if(config.mode==='SQL'&&enabled===0)issues.push(error('ENABLED_QUERY_REQUIRED','SQL 模式至少需要一条启用的查询'))
  if(config.mode==='JSON'&&enabled>0)issues.push(error('JSON_ENABLED_QUERY','JSON 模式不能保留启用状态的 SQL 查询'))

  return issues
}

function validateParams(query:TemplateQueryConfig,issues:DataConfigIssue[]){
  if(!Array.isArray(query.params)){
    issues.push(error('PARAMS_REQUIRED',(query.queryId||'查询')+'：params 必须是数组',query.queryId))
    return
  }
  const names=new Set<string>()
  for(const param of query.params){
    if(!KEY.test(param.name||''))issues.push(error('PARAM_NAME_INVALID',(query.queryId||'查询')+'：参数名非法：'+(param.name||'空'),query.queryId,param.name))
    else if(names.has(param.name))issues.push(error('PARAM_DUPLICATE',(query.queryId||'查询')+'：参数重复：'+param.name,query.queryId,param.name))
    else names.add(param.name)
    if(!PARAM_TYPES.has(param.type))issues.push(error('PARAM_TYPE_INVALID',(query.queryId||'查询')+'：参数 '+param.name+' 类型非法',query.queryId,param.name))
    if(param.defaultValue!==undefined&&!validDefault(param))issues.push(error('PARAM_DEFAULT_INVALID',(query.queryId||'查询')+'：参数 '+param.name+' 的默认值与 '+param.type+' 不匹配',query.queryId,param.name))
  }

  const used=namedParams(query.sql||'')
  for(const name of used)if(!names.has(name))issues.push(error('PARAM_UNDEFINED',(query.queryId||'查询')+'：SQL 参数未定义：'+name,query.queryId,name))
  for(const name of names)if(!used.has(name))issues.push(warning('PARAM_UNUSED',(query.queryId||'查询')+'：参数未在 SQL 中使用：'+name,query.queryId,name))
}

function validDefault(param:TemplateQueryParam){
  const value=param.defaultValue
  if(value===null)return true
  switch(param.type){
    case 'STRING': return typeof value==='string'
    case 'INTEGER': return typeof value==='number'&&Number.isInteger(value)
    case 'DECIMAL': return (typeof value==='number'&&Number.isFinite(value))||(typeof value==='string'&&value.trim()!==''&&!Number.isNaN(Number(value)))
    case 'BOOLEAN': return typeof value==='boolean'
    case 'DATE': return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
    case 'DATETIME': return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
    default:return false
  }
}

function namedParams(sql:string){
  const result=new Set<string>()
  const scrubbed=sql
    .replace(/'(?:''|[^'])*'/g,' ')
    .replace(/"(?:""|[^"])*"/g,' ')
    .replace(/--[^\n]*/g,' ')
    .replace(/\/\*[\s\S]*?\*\//g,' ')
  const re=/(?<!:):([A-Za-z_][A-Za-z0-9_]{0,63})/g
  let match:RegExpExecArray|null
  while((match=re.exec(scrubbed)))result.add(match[1])
  return result
}

function stripLeadingComments(sql:string){
  let value=sql.trimStart()
  for(;;){
    if(value.startsWith('--')){
      const newline=value.indexOf('\n')
      value=newline<0?'':value.slice(newline+1).trimStart()
      continue
    }
    if(value.startsWith('/*')){
      const end=value.indexOf('*/')
      value=end<0?'':value.slice(end+2).trimStart()
      continue
    }
    return value
  }
}

function error(code:string,message:string,queryId?:string,paramName?:string):DataConfigIssue{
  return {level:'error',code,message,queryId,paramName}
}
function warning(code:string,message:string,queryId?:string,paramName?:string):DataConfigIssue{
  return {level:'warning',code,message,queryId,paramName}
}
