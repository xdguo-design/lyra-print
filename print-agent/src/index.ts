import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { appendFile,mkdir,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises'
import { cpus,freemem,homedir,hostname,platform,release,tmpdir,totalmem } from 'node:os'
import { dirname,join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync=promisify(execFile)
const port=Number(process.env.PRINT_AGENT_PORT||18181)
const startedAt=new Date().toISOString()
const adapter=(process.env.PRINT_AGENT_ADAPTER||'mock').trim()||'mock'
const command=(process.env.PRINT_AGENT_COMMAND||'').trim()
const commandArgs=parseArgs(process.env.PRINT_AGENT_ARGS_JSON)
const commandPrintEnabled=adapter==='command'&&!!command
const rawPrintEnabled=process.platform==='win32'&&adapter!=='mock'
const osPrintEnabled=commandPrintEnabled||rawPrintEnabled
const jobs=new Map<string,unknown>()
const bindings=new Map<string,SpoolerBinding>()
const journalFile=(process.env.PRINT_AGENT_BINDING_JOURNAL||join(homedir(),'.print-platform','spooler-bindings.jsonl')).trim()
const platformUrl=(process.env.PRINT_PLATFORM_URL||'').trim().replace(/\/$/,'')
const platformApiKey=(process.env.PRINT_PLATFORM_API_KEY||'').trim()
const agentId=(process.env.PRINT_AGENT_ID||('print-agent-'+hostname())).trim()
const agentInstanceId=(process.env.PRINT_AGENT_INSTANCE_ID||hostname()).trim()
const agentVersion=(process.env.PRINT_AGENT_VERSION||'0.1.0').trim()
const heartbeatSeconds=Math.max(5,Number(process.env.PRINT_AGENT_HEARTBEAT_SECONDS||30)||30)

type PrinterInfo={id:string;name:string;type:string;status:string;isDefault:boolean;paperSizes?:string[];driverName?:string|null;portName?:string|null;shared?:boolean;shareName?:string|null;location?:string|null;comment?:string|null}
type RawLanguage='ESC_POS'|'ZPL'|'TSPL'|'CPCL'

type SpoolerJob={
  id:string;printerId:string;documentName:string;status:string;submittedAt?:string|null;
  size?:number|null;pagesPrinted?:number|null;totalPages?:number|null
}

type SpoolerBinding={
  taskId:string;agentJobId:string;printerId:string;spoolerJobId:number;documentName:string;
  status:string;boundAt:string;lastObservedAt?:string|null
}

const mockPrinters:PrinterInfo[]=[
  {id:'cashier-a4-02',name:'收费处-A4-02',type:'A4',status:'ONLINE',isDefault:true},
  {id:'front-desk-pos-01',name:'前台-小票机-01',type:'ESC_POS',status:'ONLINE',isDefault:false},
  {id:'lab-label-01',name:'检验科-标签机',type:'LABEL',status:'ATTENTION',isDefault:false}
]

function parseArgs(raw?:string){
  if(!raw)return ['{file}','{printer}','{copies}']
  try{
    const value=JSON.parse(raw)
    return Array.isArray(value)&&value.every(x=>typeof x==='string')?value:['{file}','{printer}','{copies}']
  }catch{return ['{file}','{printer}','{copies}']}
}

async function readJson(req:any,maxBytes=30_000_000){
  let body=''
  for await(const chunk of req){
    body+=chunk
    if(Buffer.byteLength(body,'utf8')>maxBytes)throw new Error('request_too_large')
  }
  try{return body?JSON.parse(body):{}}catch{throw new Error('invalid_json')}
}

function send(res:any,status:number,body:unknown){
  res.statusCode=status
  res.setHeader('content-type','application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function loadJournal(){
  try{
    const raw=await readFile(journalFile,'utf8')
    for(const line of raw.split(/\r?\n/)){
      if(!line.trim())continue
      try{
        const b=JSON.parse(line) as SpoolerBinding
        if(b?.taskId&&Number.isFinite(Number(b.spoolerJobId)))bindings.set(b.taskId,b)
      }catch{}
    }
  }catch{}
}

async function persistBinding(binding:SpoolerBinding){
  bindings.set(binding.taskId,binding)
  await mkdir(dirname(journalFile),{recursive:true})
  await appendFile(journalFile,JSON.stringify(binding)+'\n','utf8')
}

function mapSpoolerStatus(value:string){
  const s=String(value||'').toUpperCase()
  if(s.includes('PAUSED'))return 'PAUSED'
  if(s.includes('PRINTING'))return 'PRINTING'
  if(s.includes('SPOOL'))return 'SPOOLING'
  if(s.includes('DELET'))return 'CANCELED'
  if(s.includes('ERROR')||s.includes('BLOCKED')||s.includes('OFFLINE')||s.includes('PAPER'))return 'FAILED'
  if(s.includes('COMPLETED')||s.includes('PRINTED'))return 'COMPLETED'
  return s||'UNKNOWN'
}

async function spoolerJobs(printerId:string):Promise<SpoolerJob[]>{
  if(process.platform!=='win32')throw new Error('spooler_monitor_unsupported')
  const script=[
    '$printer=$args[0]',
    'Get-PrintJob -PrinterName $printer -ErrorAction Stop |',
    'Select-Object ID,DocumentName,JobStatus,SubmitTime,Size,PagesPrinted,TotalPages |',
    'ConvertTo-Json -Compress'
  ].join(' ')
  const {stdout}=await execFileAsync(
    'powershell.exe',
    ['-NoProfile','-NonInteractive','-Command',script,printerId],
    {windowsHide:true,timeout:5000,maxBuffer:1024*1024}
  )
  const raw=stdout.trim()
  if(!raw)return []
  const value=JSON.parse(raw)
  const rows=Array.isArray(value)?value:[value]
  return rows.filter(Boolean).map((job:any)=>({
    id:String(job.ID),
    printerId,
    documentName:String(job.DocumentName||''),
    status:mapSpoolerStatus(String(job.JobStatus||'UNKNOWN')),
    submittedAt:job.SubmitTime?String(job.SubmitTime):null,
    size:Number.isFinite(Number(job.Size))?Number(job.Size):null,
    pagesPrinted:Number.isFinite(Number(job.PagesPrinted))?Number(job.PagesPrinted):null,
    totalPages:Number.isFinite(Number(job.TotalPages))?Number(job.TotalPages):null
  }))
}

async function observeBinding(taskId:string){
  const binding=bindings.get(taskId)
  if(!binding)throw new Error('spooler_binding_not_found')
  const rows=await spoolerJobs(binding.printerId)
  const row=rows.find(x=>Number(x.id)===binding.spoolerJobId)
  const next:SpoolerBinding={...binding,status:row?.status||(binding.status==='CANCELED'?'CANCELED':'UNKNOWN'),lastObservedAt:new Date().toISOString()}
  await persistBinding(next)
  return {...next,job:row||null}
}

async function controlSpoolerJob(printerId:string,jobId:number,action:'pause'|'resume'|'cancel'){
  if(process.platform!=='win32')throw new Error('spooler_control_unsupported')
  const cmd=action==='pause'?'Suspend-PrintJob':action==='resume'?'Resume-PrintJob':'Remove-PrintJob'
  const script=`$printer=$args[0];$id=[int]$args[1];${cmd} -PrinterName $printer -ID $id -ErrorAction Stop`
  await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script,printerId,String(jobId)],{windowsHide:true,timeout:5000,maxBuffer:1024*1024})
  return
}

async function printers():Promise<PrinterInfo[]>{
  if(adapter==='mock')return mockPrinters
  const configured=(process.env.PRINT_AGENT_PRINTERS_JSON||'').trim()
  if(configured){
    try{
      const list=JSON.parse(configured)
      if(Array.isArray(list))return list.map((p:any)=>({
        id:String(p.id||p.name),name:String(p.name||p.id),type:String(p.type||'SYSTEM'),
        status:String(p.status||'ONLINE').toUpperCase(),isDefault:Boolean(p.isDefault),
        paperSizes:Array.isArray(p.paperSizes)?p.paperSizes.map(String):[],
        driverName:p.driverName==null?null:String(p.driverName),portName:p.portName==null?null:String(p.portName),
        shared:Boolean(p.shared),shareName:p.shareName==null?null:String(p.shareName),
        location:p.location==null?null:String(p.location),comment:p.comment==null?null:String(p.comment)
      }))
    }catch{}
  }
  if(process.platform==='win32'){
    try{
      const script='Get-CimInstance Win32_Printer | Select-Object Name,PrinterStatus,Default,DriverName,PortName,Shared,ShareName,Location,Comment | ConvertTo-Json -Compress'
      const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000})
      const value=JSON.parse(stdout.trim()||'[]')
      const rows=Array.isArray(value)?value:[value]
      return rows.filter(Boolean).map((p:any)=>({
        id:String(p.Name),name:String(p.Name),type:'WINDOWS',
        status:Number(p.PrinterStatus)===7?'OFFLINE':Number(p.PrinterStatus)===6?'ERROR':'ONLINE',
        isDefault:Boolean(p.Default),paperSizes:[],
        driverName:p.DriverName==null?null:String(p.DriverName),portName:p.PortName==null?null:String(p.PortName),
        shared:Boolean(p.Shared),shareName:p.ShareName==null?null:String(p.ShareName),
        location:p.Location==null?null:String(p.Location),comment:p.Comment==null?null:String(p.Comment)
      }))
    }catch{}
  }
  return []
}

function substitute(value:string,input:any,file:string){
  const pageSize=input.pageSize||{}
  return value
    .replaceAll('{file}',file)
    .replaceAll('{printer}',String(input.printerId||''))
    .replaceAll('{copies}',String(Math.max(1,Math.min(99,Number(input.copies)||1))))
    .replaceAll('{title}',String(input.title||'Print Platform'))
    .replaceAll('{duplex}',String(input.printOptions?.duplexMode||'SIMPLEX'))
    .replaceAll('{color}',String(input.printOptions?.colorMode||'AUTO'))
    .replaceAll('{fitMode}',String(input.printOptions?.fitMode||'ACTUAL'))
    .replaceAll('{paperSource}',String(input.printOptions?.paperSource||''))
    .replaceAll('{width}',String(pageSize.width||''))
    .replaceAll('{height}',String(pageSize.height||''))
    .replaceAll('{taskId}',String(input.taskId||''))
}

async function executeProduction(input:any,jobId:string){
  if(!commandPrintEnabled)throw new Error('production_print_not_enabled')
  const available=await printers()
  const printer=available.find(p=>p.id===input.printerId||p.name===input.printerId)
  if(!printer)throw new Error('printer_not_found')
  if(printer.status!=='ONLINE')throw new Error('printer_not_ready')

  const dir=await mkdtemp(join(tmpdir(),'print-platform-'))
  const kind=input.documentKind==='PDF'?'PDF':'HTML'
  const documentFile=join(dir,kind==='PDF'?'document.pdf':'document.html')
  try{
    if(kind==='PDF')await writeFile(documentFile,Buffer.from(String(input.documentBase64||''),'base64'))
    else await writeFile(documentFile,String(input.documentHtml),'utf8')
    const args=commandArgs.map(arg=>substitute(arg,input,documentFile))
    jobs.set(jobId,{accepted:true,jobId,mode:'PRODUCTION',taskId:input.taskId,printerId:input.printerId,copies:input.copies,status:'RUNNING',adapter,executed:false,createdAt:new Date().toISOString()})
    const result=await execFileAsync(command,args,{windowsHide:true,timeout:Number(process.env.PRINT_AGENT_COMMAND_TIMEOUT_MS||120000),maxBuffer:1024*1024})
    return {
      accepted:true,jobId,mode:'PRODUCTION',taskId:input.taskId,testRunId:input.testRunId||null,
      printerId:input.printerId,title:input.title||'',copies:input.copies,documentKind:kind,printOptions:input.printOptions||{},status:'SUCCESS',adapter,executed:true,
      note:'Configured print command completed successfully. Verify physical output through printer/job monitoring when required.',
      stdout:String(result.stdout||'').slice(0,1000),createdAt:new Date().toISOString()
    }
  }finally{
    await rm(dir,{recursive:true,force:true}).catch(()=>undefined)
  }
}

function validateRaw(input:any){
  const language=String(input.rawLanguage||'').toUpperCase() as RawLanguage
  if(!['ESC_POS','ZPL','TSPL','CPCL'].includes(language))throw new Error('invalid_raw_language')
  if(typeof input.rawBase64!=='string'||!input.rawBase64.trim())throw new Error('rawBase64_required')
  const bytes=Buffer.from(input.rawBase64,'base64')
  if(!bytes.length)throw new Error('raw_payload_empty')
  if(bytes.length>10*1024*1024)throw new Error('raw_payload_too_large')
  return {language,bytes}
}

async function executeWindowsRaw(input:any,agentJobId:string){
  if(process.platform!=='win32')throw new Error('raw_print_unsupported')
  const {language,bytes}=validateRaw(input)
  const available=await printers()
  const printer=available.find(p=>p.id===input.printerId||p.name===input.printerId)
  if(!printer)throw new Error('printer_not_found')
  if(printer.status!=='ONLINE')throw new Error('printer_not_ready')

  const documentName=`PT:${input.taskId}:${agentJobId}`
  const script=`
param([string]$Printer,[string]$Document,[string]$Payload)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawSpool {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public class DOC_INFO_1 { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
 [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string pPrinterName,out IntPtr phPrinter,IntPtr pDefault);
 [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr hPrinter,int level,[In] DOC_INFO_1 di);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter,byte[] pBytes,int dwCount,out int dwWritten);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);
}
"@
$bytes=[Convert]::FromBase64String($Payload)
$h=[IntPtr]::Zero
if(-not [RawSpool]::OpenPrinter($Printer,[ref]$h,[IntPtr]::Zero)){throw "OpenPrinter failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"}
try{
  $di=New-Object RawSpool+DOC_INFO_1
  $di.pDocName=$Document
  $di.pDataType="RAW"
  $id=[RawSpool]::StartDocPrinter($h,1,$di)
  if($id -le 0){throw "StartDocPrinter failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"}
  try{
    if(-not [RawSpool]::StartPagePrinter($h)){throw "StartPagePrinter failed"}
    $written=0
    if(-not [RawSpool]::WritePrinter($h,$bytes,$bytes.Length,[ref]$written)){throw "WritePrinter failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"}
    if($written -ne $bytes.Length){throw "WritePrinter short write $written/$($bytes.Length)"}
    [void][RawSpool]::EndPagePrinter($h)
  } finally { [void][RawSpool]::EndDocPrinter($h) }
  @{jobId=$id;written=$bytes.Length}|ConvertTo-Json -Compress
} finally { [void][RawSpool]::ClosePrinter($h) }
`
  const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script,'-Printer',input.printerId,'-Document',documentName,'-Payload',bytes.toString('base64')],{windowsHide:true,timeout:Number(process.env.PRINT_AGENT_RAW_TIMEOUT_MS||30000),maxBuffer:1024*1024})
  const result=JSON.parse(stdout.trim())
  const binding:SpoolerBinding={
    taskId:String(input.taskId),agentJobId,printerId:String(input.printerId),spoolerJobId:Number(result.jobId),
    documentName,status:'SPOOLING',boundAt:new Date().toISOString(),lastObservedAt:null
  }
  await persistBinding(binding)
  return {
    accepted:true,jobId:agentJobId,mode:'PRODUCTION',taskId:input.taskId,printerId:input.printerId,copies:1,
    documentKind:'RAW',rawLanguage:language,byteLength:bytes.length,status:'SPOOLING',adapter:'windows-raw',executed:true,
    spoolerJobId:binding.spoolerJobId,spoolerDocumentName:documentName,spoolerStatus:binding.status,spoolerBoundAt:binding.boundAt,
    note:'RAW payload submitted to Windows Spooler. Completion means spooler completion, not confirmed physical paper output.',
    createdAt:new Date().toISOString()
  }
}

let previousCpu=cpuSnapshot()

function cpuSnapshot(){
  let idle=0,total=0
  for(const cpu of cpus()){
    idle+=cpu.times.idle
    total+=cpu.times.user+cpu.times.nice+cpu.times.sys+cpu.times.idle+cpu.times.irq
  }
  return {idle,total}
}

function sampleCpuUsage(){
  const current=cpuSnapshot()
  const idle=current.idle-previousCpu.idle
  const total=current.total-previousCpu.total
  previousCpu=current
  if(total<=0)return 0
  return Math.max(0,Math.min(100,Number(((1-idle/total)*100).toFixed(1))))
}

async function windowsSpoolerStatus(){
  if(process.platform!=='win32')return 'UNSUPPORTED'
  try{
    const {stdout}=await execFileAsync(
      'powershell.exe',
      ['-NoProfile','-NonInteractive','-Command','(Get-Service Spooler -ErrorAction Stop).Status.ToString()'],
      {windowsHide:true,timeout:3000,maxBuffer:64*1024}
    )
    return String(stdout||'').trim().toUpperCase()||'UNKNOWN'
  }catch{return 'UNKNOWN'}
}

function jobCounts(){
  let active=0,queued=0
  for(const value of jobs.values()){
    const status=String((value as any)?.status||'').toUpperCase()
    if(['RUNNING','PRINTING','SPOOLING'].includes(status))active++
    if(['ACCEPTED','QUEUED'].includes(status))queued++
  }
  return {active,queued}
}

async function sendHeartbeat(){
  if(!platformUrl)return
  try{
    const printerList=await printers()
    const counts=jobCounts()
    const body={
      agentId,instanceId:agentInstanceId,hostName:hostname(),osName:platform()+' '+release(),agentVersion,
      cpuUsage:sampleCpuUsage(),memoryUsage:Number(((1-freemem()/Math.max(1,totalmem()))*100).toFixed(1)),
      activeJobs:counts.active,queuedJobs:counts.queued,printerCount:printerList.length,
      spoolerStatus:await windowsSpoolerStatus(),printers:printerList.map(p=>({
        printerId:p.id,name:p.name,type:p.type,status:p.status,defaultPrinter:p.isDefault,
        driverName:p.driverName??null,portName:p.portName??null,shared:Boolean(p.shared),
        shareName:p.shareName??null,location:p.location??null,comment:p.comment??null,
        paperSizes:Array.isArray(p.paperSizes)?p.paperSizes:[]
      }))
    }
    const headers:Record<string,string>={'content-type':'application/json'}
    if(platformApiKey)headers.authorization='Bearer '+platformApiKey
    const response=await fetch(platformUrl+'/api/agents/heartbeat',{
      method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(5000)
    })
    if(!response.ok)console.warn('agent heartbeat rejected:',response.status,await response.text().catch(()=>''))
  }catch(error:any){
    console.warn('agent heartbeat failed:',error?.message||String(error))
  }
}

await loadJournal()

const server=createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/health'){
    const list=await printers()
    send(res,200,{
      status:'UP',agent:'print-agent',adapter,osPrintEnabled,
      productionReady:commandPrintEnabled||rawPrintEnabled,
      rawPrintEnabled,printers:list.length,startedAt,now:new Date().toISOString(),
      executionSemantics:commandPrintEnabled?'COMMAND_EXIT_SUCCESS':rawPrintEnabled?'WINDOWS_SPOOLER_SUBMITTED':'MOCK_ONLY',
      spoolerMonitoring:process.platform==='win32',spoolerControl:process.platform==='win32'
    })
    return
  }
  if(req.method==='GET'&&req.url==='/printers'){
    const list=await printers()
    send(res,200,list.map(p=>({...p,agentStatus:'UP',adapter,productionReady:commandPrintEnabled||rawPrintEnabled})))
    return
  }

  if(req.method==='GET'&&req.url?.startsWith('/spooler/jobs')){
    if(process.platform!=='win32'){send(res,501,{error:'spooler_monitor_unsupported',message:'Windows spooler monitoring is only available on Windows.'});return}
    try{
      const url=new URL(req.url,'http://127.0.0.1')
      const printerId=url.searchParams.get('printerId')||''
      if(!printerId){send(res,400,{error:'printerId_required'});return}
      send(res,200,await spoolerJobs(printerId))
    }catch(error:any){send(res,502,{error:'spooler_query_failed',message:error?.message||'spooler query failed'})}
    return
  }

  if(req.method==='GET'&&req.url?.startsWith('/spooler/bindings/')){
    try{send(res,200,await observeBinding(decodeURIComponent(req.url.slice('/spooler/bindings/'.length))))}
    catch(error:any){send(res,error?.message==='spooler_binding_not_found'?404:502,{error:error?.message||'binding_query_failed'})}
    return
  }

  const controlMatch=req.url?.match(/^\/spooler\/bindings\/([^/]+)\/(pause|resume|cancel)$/)
  if(req.method==='POST'&&controlMatch){
    if(process.platform!=='win32'){send(res,501,{error:'spooler_control_unsupported'});return}
    const taskId=decodeURIComponent(controlMatch[1])
    const action=controlMatch[2] as 'pause'|'resume'|'cancel'
    const binding=bindings.get(taskId)
    if(!binding){send(res,404,{error:'spooler_binding_not_found'});return}
    try{
      await controlSpoolerJob(binding.printerId,binding.spoolerJobId,action)
      const explicit:SpoolerBinding={...binding,status:action==='pause'?'PAUSED':action==='cancel'?'CANCELED':'PRINTING',lastObservedAt:new Date().toISOString()}
      await persistBinding(explicit)
      const updated=action==='cancel'?{...explicit,job:null}:await observeBinding(taskId).catch(()=>({...explicit,job:null}))
      send(res,200,updated)
    }catch(error:any){send(res,502,{error:'spooler_control_failed',message:error?.message||'spooler control failed'})}
    return
  }

  if(req.method==='GET'&&req.url?.startsWith('/jobs/')){
    const id=decodeURIComponent(req.url.slice('/jobs/'.length))
    const job=jobs.get(id)
    if(!job){send(res,404,{error:'job_not_found'});return}
    send(res,200,job);return
  }

  if(req.method==='POST'&&req.url==='/print'){
    try{
      const input=await readJson(req)
      const mode=input.mode||'TEST'
      if(!['TEST','PRODUCTION'].includes(mode)){send(res,400,{error:'invalid_mode'});return}
      input.copies=Math.max(1,Math.min(99,Number(input.copies)||1))
      if(!input.taskId||!input.printerId){send(res,400,{error:'taskId_and_printerId_required'});return}
      const kind=input.documentKind==='PDF'?'PDF':input.documentKind==='RAW'?'RAW':'HTML'
      if(kind==='RAW'){
        if(mode!=='PRODUCTION'){send(res,400,{error:'raw_test_mode_not_supported'});return}
        if(input.copies!==1){send(res,400,{error:'raw_copies_must_be_one',message:'RAW payload must encode copies explicitly; PrintTask RAW snapshot is byte-exact.'});return}
      }else if(kind==='PDF'){
        if(typeof input.documentBase64!=='string'||!input.documentBase64.trim()){send(res,400,{error:'documentBase64_required'});return}
        const bytes=Buffer.from(input.documentBase64,'base64')
        if(bytes.length<5||bytes.subarray(0,5).toString('ascii')!=='%PDF-'){send(res,400,{error:'invalid_pdf'});return}
        if(bytes.length>20*1024*1024){send(res,413,{error:'pdf_too_large'});return}
      }else if(typeof input.documentHtml!=='string'||!input.documentHtml.trim()){send(res,400,{error:'documentHtml_required'});return}

      const jobId='agent-'+Date.now()+'-'+Math.random().toString(16).slice(2,8)
      if(mode==='PRODUCTION'){
        try{
          const job=kind==='RAW'?await executeWindowsRaw(input,jobId):await executeProduction(input,jobId)
          jobs.set(jobId,job)
          send(res,200,job)
        }catch(error:any){
          const message=error?.message||'production_print_failed'
          const code=message==='printer_not_found'?400:message==='printer_not_ready'?409:message==='raw_print_unsupported'||message==='production_print_not_enabled'?503:message==='raw_payload_too_large'?413:400
          const job={accepted:false,jobId,mode:'PRODUCTION',taskId:input.taskId,printerId:input.printerId,copies:input.copies,status:'FAILED',adapter,executed:false,note:message,createdAt:new Date().toISOString()}
          jobs.set(jobId,job)
          send(res,code,{...job,error:message})
        }
        return
      }

      const available=await printers()
      const printer=available.find(p=>p.id===input.printerId||p.name===input.printerId)
      if(!printer){send(res,400,{error:'printer_not_found'});return}
      if(printer.status!=='ONLINE'){send(res,409,{error:'printer_not_ready',printerStatus:printer.status});return}
      const job={accepted:true,jobId,mode,taskId:input.taskId,testRunId:input.testRunId||null,printerId:input.printerId,title:input.title||'',copies:input.copies,documentKind:kind,printOptions:input.printOptions||{},status:'ACCEPTED',adapter,executed:false,note:'Test document accepted; no physical print was executed.',createdAt:new Date().toISOString()}
      jobs.set(jobId,job)
      send(res,202,job)
    }catch(error:any){
      send(res,error?.message==='request_too_large'?413:400,{error:error?.message||'bad_request'})
    }
    return
  }

  send(res,404,{error:'not_found'})
})

server.listen(port,'127.0.0.1',()=>{
  console.log(`print-agent listening on http://127.0.0.1:${port}`)
  if(platformUrl){
    console.log(`agent heartbeat enabled: ${agentId}/${agentInstanceId} -> ${platformUrl}`)
    setTimeout(()=>void sendHeartbeat(),500)
    setInterval(()=>void sendHeartbeat(),heartbeatSeconds*1000)
  }
})
