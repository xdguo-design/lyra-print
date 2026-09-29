export type PrintTaskStatus='CREATED'|'QUEUED'|'PRINTING'|'SUCCESS'|'FAILED'|'RETRYING'|'WAITING_AGENT'|'CANCELLED'

export interface CreatePrintTaskInput{
  templateCode:string
  businessKey:string
  printerId:string
  copies?:number
  params?:Record<string,unknown>|null
  inputData?:Record<string,unknown>|null
}

export interface PrintTask{
  id:string
  templateCode:string
  templateVersion?:number|null
  businessKey:string
  snapshotId:string
  printerId?:string|null
  copies:number
  status:PrintTaskStatus
  attempts:number
  message?:string|null
  createdAt?:string
  updatedAt?:string
}

export interface PrintTaskDocument{
  taskId:string
  templateCode:string
  templateVersion?:number|null
  templateName:string
  documentType:string
  documentKind:'TEMPLATE'|'PDF'|'RAW'
  businessKey:string
  printerId?:string|null
  copies:number
  design?:Record<string,unknown>|null
  renderData?:Record<string,unknown>|null
  pdfBase64?:string|null
  rawLanguage?:'ESC_POS'|'ZPL'|'TSPL'|'CPCL'|null
  rawBase64?:string|null
  byteLength?:number|null
  sha256?:string|null
  createdAt:string
}

export interface CreatePrintPreviewInput{
  templateCode:string
  params?:Record<string,unknown>|null
  inputData?:Record<string,unknown>|null
}

export interface PrintPreview{
  templateCode:string
  templateVersion:number
  templateName:string
  documentType:string
  design:Record<string,unknown>
  renderData:Record<string,unknown>
  generatedAt:string
}

export interface PrintPlatformClientOptions{
  baseUrl?:string
  apiKey?:string
  headers?:Record<string,string>
  fetch?:typeof fetch
}

export class PrintPlatformClient{
  private readonly baseUrl:string
  private apiKey:string
  private readonly headers:Record<string,string>
  private readonly fetchImpl:typeof fetch

  constructor(options:string|PrintPlatformClientOptions='http://localhost:8080'){
    const normalized=typeof options==='string'?{baseUrl:options}:options
    this.baseUrl=(normalized.baseUrl||'http://localhost:8080').replace(/\/$/,'')
    this.apiKey=normalized.apiKey||''
    this.headers={...(normalized.headers||{})}
    this.fetchImpl=normalized.fetch||fetch
  }

  setApiKey(apiKey:string){this.apiKey=apiKey.trim()}

  async createPreview(input:CreatePrintPreviewInput):Promise<PrintPreview>{
    return this.request('/api/print-previews',{method:'POST',body:JSON.stringify(input)})
  }

  async createTask(input:CreatePrintTaskInput):Promise<PrintTask>{
    return this.request('/api/print-tasks',{method:'POST',body:JSON.stringify({...input,copies:input.copies??1})})
  }

  async getTask(id:string):Promise<PrintTask>{
    return this.request(`/api/print-tasks/${encodeURIComponent(id)}`)
  }

  async getTaskDocument(id:string):Promise<PrintTaskDocument>{
    return this.request(`/api/print-tasks/${encodeURIComponent(id)}/document`)
  }

  async listTasks():Promise<PrintTask[]>{
    return this.request('/api/print-tasks')
  }

  async queue(id:string):Promise<PrintTask>{return this.action(id,'queue')}
  async start(id:string):Promise<PrintTask>{return this.action(id,'start')}
  async succeed(id:string):Promise<PrintTask>{return this.action(id,'success')}
  async fail(id:string,reason?:string):Promise<PrintTask>{return this.action(id,'fail',reason?{reason}:undefined)}
  async waitForAgent(id:string,reason?:string):Promise<PrintTask>{return this.action(id,'wait-agent',reason?{reason}:undefined)}
  async cancel(id:string):Promise<PrintTask>{return this.action(id,'cancel')}
  async retry(id:string,printerId?:string):Promise<PrintTask>{return this.action(id,'retry',printerId?{printerId}:undefined)}

  private async action(id:string,name:string,body?:unknown):Promise<PrintTask>{
    return this.request(`/api/print-tasks/${encodeURIComponent(id)}/${name}`,{
      method:'POST',
      body:body===undefined?undefined:JSON.stringify(body)
    })
  }

  private async request<T>(path:string,init:RequestInit={}):Promise<T>{
    const headers:Record<string,string>={
      'content-type':'application/json',
      ...this.headers,
      ...Object.fromEntries(new Headers(init.headers||{}).entries())
    }
    if(this.apiKey&&!headers.Authorization&&!headers.authorization)headers.Authorization='Bearer '+this.apiKey
    const response=await this.fetchImpl(this.baseUrl+path,{...init,headers})
    if(!response.ok)throw new Error(`Print platform request failed: ${response.status} ${await response.text()}`)
    return response.json() as Promise<T>
  }
}
