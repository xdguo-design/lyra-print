import type { AgentHealth,AgentPrintJob,LocalPrinter,SpoolerJob } from '../types'

type BridgeResponse<T>={ok:boolean;data?:T;error?:string}

function request<T>(type:'HEALTH'|'LIST_PRINTERS'|'PRINT'|'GET_JOB'|'LIST_SPOOLER_JOBS'|'GET_SPOOLER_BINDING'|'CONTROL_SPOOLER',payload?:unknown,timeoutMs=6000):Promise<T>{
  const requestId='req-'+Date.now()+'-'+Math.random().toString(16).slice(2)
  return new Promise<T>((resolve,reject)=>{
    const timer=window.setTimeout(()=>{
      window.removeEventListener('message',onMessage)
      reject(new Error('本地打印扩展响应超时'))
    },timeoutMs)

    function onMessage(event:MessageEvent){
      if(event.source!==window||event.data?.source!=='print-platform-extension'||event.data?.requestId!==requestId)return
      window.clearTimeout(timer)
      window.removeEventListener('message',onMessage)
      const response=event.data.response as BridgeResponse<T>|undefined
      if(!response?.ok){reject(new Error(response?.error||'本地打印扩展调用失败'));return}
      resolve(response.data as T)
    }

    window.addEventListener('message',onMessage)
    window.postMessage({source:'print-platform-page',type,requestId,payload},'*')
  })
}

export function getAgentHealth():Promise<AgentHealth>{return request<AgentHealth>('HEALTH')}
export function listLocalPrinters():Promise<LocalPrinter[]>{return request<LocalPrinter[]>('LIST_PRINTERS')}
export function getAgentJob(jobId:string):Promise<AgentPrintJob>{return request<AgentPrintJob>('GET_JOB',{jobId})}
export function listSpoolerJobs(printerId:string):Promise<SpoolerJob[]>{return request<SpoolerJob[]>('LIST_SPOOLER_JOBS',{printerId})}
export function getSpoolerBinding(taskId:string):Promise<any>{return request<any>('GET_SPOOLER_BINDING',{taskId})}
export function controlSpooler(taskId:string,action:'pause'|'resume'|'cancel'):Promise<any>{return request<any>('CONTROL_SPOOLER',{taskId,action})}

export function printViaExtension(input:{
  testRunId?:string
  taskId?:string
  printerId:string
  title:string
  documentHtml:string
  pageSize:{width:number;height:number}
  mode?:'TEST'|'PRODUCTION'
  copies?:number
  printOptions?:{duplexMode?:string;colorMode?:string;fitMode?:string;paperSource?:string}
}):Promise<AgentPrintJob>{
  return request<AgentPrintJob>('PRINT',{...input,mode:input.mode||'TEST'},15000)
}

export function printPdfViaExtension(input:{
  taskId:string
  printerId:string
  title:string
  pdfBase64:string
  copies?:number
  printOptions?:{duplexMode?:string;colorMode?:string;fitMode?:string;paperSource?:string}
}):Promise<AgentPrintJob>{
  return request<AgentPrintJob>('PRINT',{
    mode:'PRODUCTION',taskId:input.taskId,printerId:input.printerId,title:input.title,
    documentKind:'PDF',documentBase64:input.pdfBase64,copies:input.copies??1,printOptions:input.printOptions
  },30000)
}


export function printRawViaExtension(input:{
  taskId:string
  printerId:string
  title:string
  rawLanguage:'ESC_POS'|'ZPL'|'TSPL'|'CPCL'
  rawBase64:string
}):Promise<AgentPrintJob>{
  return request<AgentPrintJob>('PRINT',{
    mode:'PRODUCTION',taskId:input.taskId,printerId:input.printerId,title:input.title,
    documentKind:'RAW',rawLanguage:input.rawLanguage,rawBase64:input.rawBase64,copies:1
  },30000)
}
