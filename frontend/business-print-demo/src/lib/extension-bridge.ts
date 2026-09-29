const PAGE_SOURCE='print-platform-page'
const EXTENSION_SOURCE='print-platform-extension'

export type BridgeCommand='HEALTH'|'LIST_PRINTERS'|'PRINT'|'GET_JOB'|'LIST_SPOOLER_JOBS'|'GET_SPOOLER_BINDING'|'CONTROL_SPOOLER'

export interface LocalPrinter{
  id:string
  name:string
  type?:string
  status?:string
  isDefault?:boolean
}

export interface ExtensionResponse<T=unknown>{
  ok:boolean
  data?:T
  error?:string
}

export interface PrintBridgePayload{
  mode:'TEST'|'PRODUCTION'
  taskId:string
  printerId:string
  copies:number
  title:string
  documentHtml:string
  pageSize:{width:number;height:number}
  printOptions?:{
    duplexMode?:'SIMPLEX'|'LONG_EDGE'|'SHORT_EDGE'
    colorMode?:'AUTO'|'COLOR'|'MONOCHROME'
    fitMode?:'ACTUAL'|'FIT'
    paperSource?:string
  }
}

export function extensionRequest<T=unknown>(
  type:BridgeCommand,
  payload:unknown={},
  timeoutMs=5000
):Promise<ExtensionResponse<T>>{
  const requestId=crypto.randomUUID()
  return new Promise(resolve=>{
    let settled=false
    const finish=(result:ExtensionResponse<T>)=>{
      if(settled)return
      settled=true
      window.removeEventListener('message',onMessage)
      clearTimeout(timer)
      resolve(result)
    }
    const onMessage=(event:MessageEvent)=>{
      if(event.source!==window)return
      if(event.data?.source!==EXTENSION_SOURCE||event.data?.requestId!==requestId)return
      finish(event.data.response||{ok:false,error:'扩展返回空响应'})
    }
    const timer=window.setTimeout(()=>finish({
      ok:false,
      error:'未检测到 Print Platform 浏览器扩展，或本地 Print Agent 未响应'
    }),timeoutMs)
    window.addEventListener('message',onMessage)
    window.postMessage({source:PAGE_SOURCE,type,requestId,payload},'*')
  })
}

export async function getExtensionHealth(){
  return extensionRequest<Record<string,unknown>>('HEALTH',{},2500)
}

export async function listLocalPrinters(){
  return extensionRequest<LocalPrinter[]>('LIST_PRINTERS',{},3500)
}

export async function sendPrint(payload:PrintBridgePayload){
  return extensionRequest<Record<string,unknown>>('PRINT',payload,30000)
}
