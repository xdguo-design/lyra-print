<script setup lang="ts">
import { computed,onMounted,onUnmounted,reactive,ref,watch } from 'vue'
import { Modal,message } from 'ant-design-vue'
import {
  action,bindSpooler,createPdfTask,createRawTask,createTask,getRuntimeCapabilities,getTaskAttempts,getTaskDocument,getTaskSummary,
  listPrinterProfiles,listTasks,listTemplates,savePrinterProfile,updateSpoolerStatus
} from '../api'
import type {
  AgentHealth,CreatePrintTaskInput,LocalPrinter,PrinterProfile,PrintTask,PrintTaskAttempt,PrintTaskDocument,
  PrintTaskStatus,PrintTaskSummary,PrintTemplate,RuntimeCapabilities,SpoolerJob
} from '../types'
import { apiProblem,parseJsonObject } from '../template-data-ui'
import { controlSpooler,getAgentHealth,getSpoolerBinding,listLocalPrinters,listSpoolerJobs,printPdfViaExtension,printRawViaExtension } from '../print/extension-bridge'
import PreviewModal from './PreviewModal.vue'

const tasks=ref<PrintTask[]>([])
const summary=ref<PrintTaskSummary>({
  total:0,created:0,queued:0,printing:0,succeeded:0,failed:0,retrying:0,waitingAgent:0,cancelled:0,active:0
})
const templates=ref<PrintTemplate[]>([])
const printers=ref<LocalPrinter[]>([])
const printerProfiles=ref<PrinterProfile[]>([])
const capabilities=ref<RuntimeCapabilities|null>(null)
const agent=ref<AgentHealth|null>(null)
const agentError=ref('')
const loading=ref(false)
const agentLoading=ref(false)
const autoRefresh=ref(true)
const lastRefresh=ref('')
let timer:number|undefined

const filters=reactive({status:'',templateCode:'',printerId:'',keyword:''})
const createOpen=ref(false)
const createBusy=ref(false)
const pdfOpen=ref(false)
const pdfBusy=ref(false)
const pdfForm=reactive({title:'',businessKey:'',printerId:'',copies:1,pdfBase64:'',fileName:''})
const rawOpen=ref(false)
const rawBusy=ref(false)
const rawForm=reactive({
  title:'',businessKey:'',printerId:'',rawLanguage:'ZPL' as 'ESC_POS'|'ZPL'|'TSPL'|'CPCL',rawBase64:''
})
const createForm=reactive({templateCode:'',businessKey:'',printerId:'',copies:1,paramsText:'{}',inputText:''})
const selectedTemplate=computed(()=>templates.value.find(t=>t.code===createForm.templateCode)||null)

const detailOpen=ref(false)
const detailBusy=ref(false)
const detailTask=ref<PrintTask|null>(null)
const detailDocument=ref<PrintTaskDocument|null>(null)
const attempts=ref<PrintTaskAttempt[]>([])

const retryOpen=ref(false)
const retryBusy=ref(false)
const retryTask=ref<PrintTask|null>(null)
const retryPrinterId=ref('')

const failureOpen=ref(false)
const failureBusy=ref(false)
const failureTask=ref<PrintTask|null>(null)
const failureReason=ref('未收到本地打印完成确认')

const printerManageOpen=ref(false)
const printerManageBusy=ref(false)
const spoolerOpen=ref(false)
const spoolerBusy=ref(false)
const spoolerPrinter=ref('')
const spoolerJobs=ref<SpoolerJob[]>([])
const printerManageId=ref('')
const printerForm=reactive({
  displayName:'',location:'',enabled:true,defaultPrinter:false,notes:'',
  offsetXmm:0,offsetYmm:0,scalePercent:100,
  duplexMode:'SIMPLEX' as 'SIMPLEX'|'LONG_EDGE'|'SHORT_EDGE',
  colorMode:'AUTO' as 'AUTO'|'COLOR'|'MONOCHROME',
  fitMode:'ACTUAL' as 'ACTUAL'|'FIT',
  paperSource:''
})

const previewOpen=ref(false)
const productionTask=ref<PrintTask|null>(null)
const productionDocument=ref<PrintTaskDocument|null>(null)
const productionTemplate=computed<PrintTemplate|null>(()=>{
  const doc=productionDocument.value
  if(!doc||doc.documentKind==='PDF'||!doc.design)return null
  return {
    id:'TASK-'+doc.taskId,code:doc.templateCode,name:doc.templateName,documentType:doc.documentType as PrintTemplate['documentType'],
    status:'PUBLISHED',draftRevision:0,publishedVersion:doc.templateVersion??undefined,
    design:doc.design,sampleData:doc.renderData||{},dataConfig:{schemaVersion:1,mode:'JSON',queries:[]},
    createdAt:doc.createdAt,updatedAt:doc.createdAt
  }
})

const publishedTemplates=computed(()=>templates.value.filter(t=>t.status==='PUBLISHED'&&t.publishedVersion))
const managedPrinters=computed(()=>{
  const local=new Map(printers.value.map(p=>[p.id,p]))
  const profiles=new Map(printerProfiles.value.map(p=>[p.printerId,p]))
  const ids=new Set([...local.keys(),...profiles.keys()])
  return [...ids].map(id=>{
    const p=local.get(id),profile=profiles.get(id)
    return {
      id,
      name:profile?.displayName||p?.name||id,
      agentName:p?.name||null,
      type:p?.type||'UNKNOWN',
      status:p?.status||'OFFLINE',
      agentDefault:p?.isDefault===true,
      enabled:profile?.enabled??true,
      defaultPrinter:profile?.defaultPrinter??false,
      location:profile?.location||'',
      notes:profile?.notes||'',
      offsetXmm:profile?.offsetXmm??0,
      offsetYmm:profile?.offsetYmm??0,
      scalePercent:profile?.scalePercent??100,
      duplexMode:profile?.duplexMode??'SIMPLEX',
      colorMode:profile?.colorMode??'AUTO',
      fitMode:profile?.fitMode??'ACTUAL',
      paperSource:profile?.paperSource||'',
      managed:!!profile,
      adapter:p?.adapter||agent.value?.adapter||''
    }
  }).sort((a,b)=>Number(b.defaultPrinter)-Number(a.defaultPrinter)||a.name.localeCompare(b.name,'zh-CN'))
})
const onlinePrinters=computed(()=>managedPrinters.value.filter(p=>p.status==='ONLINE'&&p.enabled))
const productionReady=computed(()=>agent.value?.status==='UP'&&agent.value.productionReady===true)
const stalePrintingCount=computed(()=>tasks.value.filter(isStalePrinting).length)

const statusOptions:PrintTaskStatus[]=['CREATED','QUEUED','PRINTING','SUCCESS','FAILED','RETRYING','WAITING_AGENT','CANCELLED']
const statusText:Record<PrintTaskStatus,string>={
  CREATED:'已创建',QUEUED:'排队中',PRINTING:'打印中',SUCCESS:'成功',FAILED:'失败',
  RETRYING:'待重试',WAITING_AGENT:'等待 Agent',CANCELLED:'已取消'
}
const statusColor:Record<PrintTaskStatus,string>={
  CREATED:'default',QUEUED:'blue',PRINTING:'processing',SUCCESS:'green',FAILED:'red',
  RETRYING:'orange',WAITING_AGENT:'gold',CANCELLED:'default'
}

async function refreshTasks(silent=false){
  if(!silent)loading.value=true
  try{
    const [taskRows,stats]=await Promise.all([
      listTasks({
        status:filters.status||undefined,templateCode:filters.templateCode||undefined,
        printerId:filters.printerId||undefined,keyword:filters.keyword.trim()||undefined,limit:200
      }),
      getTaskSummary()
    ])
    tasks.value=taskRows
    summary.value=stats
    lastRefresh.value=new Date().toLocaleTimeString()
  }catch(e:any){
    if(!silent)message.error(apiProblem(e,'打印任务读取失败').message)
  }finally{if(!silent)loading.value=false}
}

async function refreshAgent(silent=false){
  if(!silent)agentLoading.value=true
  agentError.value=''
  try{
    const health=await getAgentHealth()
    agent.value=health
    printers.value=await listLocalPrinters()
  }catch(e:any){
    agent.value=null;printers.value=[]
    agentError.value=e?.message||'未检测到浏览器扩展或本地 Print Agent'
  }finally{if(!silent)agentLoading.value=false}
}

async function loadTemplates(){
  try{templates.value=await listTemplates()}
  catch(e:any){message.error(apiProblem(e,'模板列表读取失败').message)}
}
async function loadPlatformManagement(){
  try{
    const [profiles,runtime]=await Promise.all([listPrinterProfiles(),getRuntimeCapabilities()])
    printerProfiles.value=profiles
    capabilities.value=runtime
  }catch(e:any){message.error(apiProblem(e,'平台运行配置读取失败').message)}
}

function schedule(){
  window.clearInterval(timer)
  if(autoRefresh.value)timer=window.setInterval(()=>{void refreshTasks(true);void refreshAgent(true)},5000)
}
watch(autoRefresh,schedule)


function openPdfCreate(){
  pdfForm.title=''
  pdfForm.businessKey=''
  pdfForm.printerId=onlinePrinters.value.find(p=>p.defaultPrinter)?.id||onlinePrinters.value[0]?.id||''
  pdfForm.copies=1
  pdfForm.pdfBase64=''
  pdfForm.fileName=''
  pdfOpen.value=true
}
function onPdfFile(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0]
  if(!file)return
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){message.error('请选择 PDF 文件');return}
  if(file.size>20*1024*1024){message.error('PDF 文件不能超过 20 MB');return}
  const reader=new FileReader()
  reader.onload=()=>{
    pdfForm.pdfBase64=String(reader.result||'')
    pdfForm.fileName=file.name
    if(!pdfForm.title)pdfForm.title=file.name.replace(/\.pdf$/i,'')
  }
  reader.readAsDataURL(file)
}
async function submitPdfCreate(){
  if(!pdfForm.pdfBase64){message.warning('请选择 PDF 文件');return}
  if(!pdfForm.title.trim()||!pdfForm.businessKey.trim()||!pdfForm.printerId){message.warning('请填写标题、业务唯一号并选择打印机');return}
  pdfBusy.value=true
  try{
    const task=await createPdfTask({
      title:pdfForm.title.trim(),businessKey:pdfForm.businessKey.trim(),printerId:pdfForm.printerId,
      copies:pdfForm.copies,pdfBase64:pdfForm.pdfBase64
    })
    pdfOpen.value=false
    message.success('PDF 正式任务已创建并冻结')
    await refreshTasks(true)
    await openDetail(task)
  }catch(e:any){message.error(apiProblem(e,'创建 PDF 正式打印任务失败').message)}
  finally{pdfBusy.value=false}
}
function downloadFrozenPdf(doc:PrintTaskDocument){
  if(!doc.pdfBase64)return
  const binary=atob(doc.pdfBase64)
  const bytes=new Uint8Array(binary.length)
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)
  const blob=new Blob([bytes],{type:'application/pdf'})
  const a=document.createElement('a')
  a.href=URL.createObjectURL(blob)
  a.download=(doc.templateName||'document')+'.pdf'
  a.click()
  URL.revokeObjectURL(a.href)
}

function openRawCreate(){
  rawForm.title=''
  rawForm.businessKey=''
  rawForm.printerId=onlinePrinters.value.find(p=>p.defaultPrinter)?.id||onlinePrinters.value[0]?.id||''
  rawForm.rawLanguage='ZPL'
  rawForm.rawBase64=''
  rawOpen.value=true
}
async function submitRawCreate(){
  if(!rawForm.title.trim()||!rawForm.businessKey.trim()||!rawForm.printerId||!rawForm.rawBase64.trim()){
    message.warning('请填写标题、业务唯一号、打印机和 RAW Base64');return
  }
  rawBusy.value=true
  try{
    const task=await createRawTask({
      title:rawForm.title.trim(),businessKey:rawForm.businessKey.trim(),printerId:rawForm.printerId,copies:1,
      rawLanguage:rawForm.rawLanguage,rawBase64:rawForm.rawBase64.trim()
    })
    rawOpen.value=false
    message.success('RAW 正式任务已创建；最终字节已冻结并计算 SHA-256')
    await refreshTasks(true)
    await openDetail(task)
  }catch(e:any){message.error(apiProblem(e,'创建 RAW 正式打印任务失败').message)}
  finally{rawBusy.value=false}
}

function openCreate(){
  const first=publishedTemplates.value[0]
  createForm.templateCode=first?.code||''
  createForm.businessKey=''
  createForm.printerId=onlinePrinters.value.find(p=>p.defaultPrinter)?.id||onlinePrinters.value.find(p=>p.agentDefault)?.id||onlinePrinters.value[0]?.id||''
  createForm.copies=1;createForm.paramsText='{}';createForm.inputText=''
  createOpen.value=true
}

async function submitCreate(){
  const template=selectedTemplate.value
  if(!template){message.warning('请选择已发布模板');return}
  if(!createForm.businessKey.trim()){message.warning('请输入业务唯一号');return}
  if(!createForm.printerId){message.warning('请选择打印机');return}
  const input:CreatePrintTaskInput={
    templateCode:template.code,businessKey:createForm.businessKey.trim(),
    printerId:createForm.printerId,copies:createForm.copies
  }
  if(template.dataConfig.mode==='SQL'){
    const parsed=parseJsonObject(createForm.paramsText)
    if(parsed.error){message.error('SQL 参数：'+parsed.error);return}
    input.params=parsed.value||{}
  }else{
    if(!createForm.inputText.trim()){
      message.error('正式 JSON 打印必须粘贴真实业务 inputData；不会自动使用模板样例数据')
      return
    }
    const parsed=parseJsonObject(createForm.inputText)
    if(parsed.error){message.error('业务数据：'+parsed.error);return}
    input.inputData=parsed.value
  }

  createBusy.value=true
  try{
    const created=await createTask(input)
    createOpen.value=false
    message.success('正式打印任务已创建，并冻结模板 v'+created.templateVersion)
    await refreshTasks(true)
    await openDetail(created)
  }catch(e:any){message.error(apiProblem(e,'创建正式打印任务失败').message)}
  finally{createBusy.value=false}
}

async function openDetail(task:PrintTask){
  detailOpen.value=true;detailBusy.value=true;detailTask.value=task;detailDocument.value=null;attempts.value=[]
  try{
    const [doc,logs]=await Promise.all([getTaskDocument(task.id),getTaskAttempts(task.id)])
    detailDocument.value=doc;attempts.value=logs
  }catch(e:any){message.error(apiProblem(e,'任务详情读取失败').message)}
  finally{detailBusy.value=false}
}

function canExecute(task:PrintTask){
  return ['CREATED','QUEUED','RETRYING','WAITING_AGENT'].includes(task.status)
}
function canCancel(task:PrintTask){return ['CREATED','QUEUED','WAITING_AGENT'].includes(task.status)}
function isStalePrinting(task:PrintTask){
  if(task.status!=='PRINTING')return false
  const updated=new Date(task.updatedAt).getTime()
  return Number.isFinite(updated)&&Date.now()-updated>120_000
}


async function runPdfProduction(task:PrintTask,doc:PrintTaskDocument){
  if(!doc.pdfBase64)throw new Error('冻结 PDF 内容缺失')
  productionTask.value=task
  productionDocument.value=doc
  Modal.confirm({
    title:'执行正式 PDF 打印？',
    content:'将使用任务创建时冻结的 PDF、打印机和份数执行。该动作进入正式 PrintTask 状态机。',
    okText:'执行打印',
    async onOk(){
      const started=performance.now()
      try{
        await prepareProduction()
        const result=await printPdfViaExtension({
          taskId:task.id,printerId:task.printerId!,title:doc.templateName,pdfBase64:doc.pdfBase64!,
          copies:task.copies,printOptions:printerOptions(task.printerId)
        })
        await onProductionResult({
          success:result.accepted===true&&result.executed===true,
          executed:result.executed===true,
          agentJobId:result.jobId,
          elapsedMs:Math.max(0,Math.round(performance.now()-started)),
          message:result.note||(result.executed?'Agent 已执行 PDF 打印':'Agent 未执行 PDF 打印')
        })
      }catch(e:any){
        await onProductionResult({success:false,executed:false,elapsedMs:Math.max(0,Math.round(performance.now()-started)),message:e?.message||'PDF 打印失败'})
      }
    }
  })
}

async function runRawProduction(task:PrintTask,doc:PrintTaskDocument){
  if(!doc.rawBase64||!doc.rawLanguage)throw new Error('冻结 RAW 内容缺失')
  productionTask.value=task
  productionDocument.value=doc
  Modal.confirm({
    title:'执行正式 RAW 打印？',
    content:'将把冻结后的原始字节直接提交到 Windows Spooler；任务会绑定真实 Spooler Job ID，不会在提交瞬间误标记为打印成功。',
    okText:'提交 RAW',
    async onOk(){
      try{
        await prepareProduction()
        const result=await printRawViaExtension({
          taskId:task.id,printerId:task.printerId!,title:doc.templateName,
          rawLanguage:doc.rawLanguage!,rawBase64:doc.rawBase64!
        })
        if(!result.executed||result.spoolerJobId==null)throw new Error(result.note||'RAW 未提交到 Windows Spooler')
        await bindSpooler(task.id,{
          agentJobId:result.jobId,spoolerJobId:result.spoolerJobId,
          documentName:result.spoolerDocumentName||('PT:'+task.id+':'+result.jobId),
          spoolerStatus:result.spoolerStatus||'SPOOLING',
          boundAt:result.spoolerBoundAt||new Date().toISOString()
        })
        message.success('已绑定 Windows Job #'+result.spoolerJobId+'；等待 Spooler 终态')
        await refreshTasks(true)
        await openDetail(productionTask.value||task)
      }catch(e:any){
        const reason=e?.message||'RAW 打印提交失败'
        try{
          const updated=await action(task.id,'fail',{reason})
          replaceTask(updated)
        }catch{}
        message.error(reason)
      }
    }
  })
}

async function reconcileSpooler(task:PrintTask){
  try{
    const binding=await getSpoolerBinding(task.id)
    await updateSpoolerStatus(task.id,binding.status||'UNKNOWN')
    if(binding.status==='COMPLETED'&&task.status==='PRINTING'){
      replaceTask(await action(task.id,'success'))
      message.success('Windows Spooler Job 已完成')
    }else if(binding.status==='FAILED'&&task.status==='PRINTING'){
      replaceTask(await action(task.id,'fail',{reason:'Windows Spooler Job 失败'}))
      message.error('Windows Spooler Job 失败')
    }else if(binding.status==='CANCELED'&&task.status==='PRINTING'){
      replaceTask(await action(task.id,'cancel'))
      message.info('Windows Spooler Job 已取消')
    }
    await refreshTasks(true)
    await openDetail(detailTask.value?.id===task.id?detailTask.value:task)
  }catch(e:any){message.error(e?.message||'Spooler 状态同步失败')}
}

async function controlBoundJob(task:PrintTask,op:'pause'|'resume'|'cancel'){
  try{
    const result=await controlSpooler(task.id,op)
    await updateSpoolerStatus(task.id,result.status||'UNKNOWN')
    if(op==='cancel'&&task.status==='PRINTING')replaceTask(await action(task.id,'cancel'))
    message.success(op==='pause'?'Windows Job 已暂停':op==='resume'?'Windows Job 已恢复':'Windows Job 已取消')
    await refreshTasks(true)
    await openDetail(detailTask.value?.id===task.id?detailTask.value:task)
  }catch(e:any){message.error(e?.message||'Windows Job 控制失败')}
}

async function openProduction(task:PrintTask){
  if(!task.printerId){message.error('任务尚未指定打印机，请先失败重试并选择打印机');return}
  if(!agent.value){message.error('本地 Agent 未连接，不能执行正式打印');return}
  if(!productionReady.value){
    message.error('Agent 当前适配器为 '+agent.value.adapter+'，未启用真实 OS 打印；正式任务不会被发送')
    return
  }
  const printer=managedPrinters.value.find(p=>p.id===task.printerId)
  if(!printer||printer.status==='OFFLINE'){message.error('Agent 未发现任务指定的打印机：'+task.printerId);return}
  if(!printer.enabled){message.error('打印机 '+printer.name+' 已在平台停用');return}
  if(printer.status!=='ONLINE'){message.error('打印机 '+printer.name+' 当前状态为 '+printer.status);return}
  try{
    const doc=await getTaskDocument(task.id)
    if(doc.documentKind==='PDF'){
      await runPdfProduction(task,doc)
      return
    }
    if(doc.documentKind==='RAW'){
      await runRawProduction(task,doc)
      return
    }
    productionTask.value=task
    productionDocument.value=doc
    previewOpen.value=true
  }catch(e:any){message.error(apiProblem(e,'冻结打印文档读取失败').message)}
}

async function prepareProduction(){
  let task=productionTask.value
  if(!task)throw new Error('正式任务上下文丢失')
  if(!productionReady.value)throw new Error('Agent 未就绪，正式打印已阻止')

  if(['CREATED','RETRYING','WAITING_AGENT'].includes(task.status)){
    task=await action(task.id,'queue')
    replaceTask(task)
  }
  if(task.status==='QUEUED'){
    task=await action(task.id,'start')
    replaceTask(task)
  }
  if(task.status!=='PRINTING')throw new Error('任务当前状态 '+task.status+' 不能执行打印')
  productionTask.value=task
}

async function onProductionResult(result:{success:boolean;executed:boolean;agentJobId?:string;elapsedMs:number;message?:string}){
  const task=productionTask.value
  if(!task)return
  try{
    if(result.success&&result.executed){
      const updated=await action(task.id,'success')
      replaceTask(updated)
      previewOpen.value=false
      message.success('正式打印完成')
    }else{
      const reason=result.message||'本地打印未执行'
      const infrastructure=/agent|扩展|连接|network|fetch|timeout|超时/i.test(reason)
      const updated=infrastructure
        ?await action(task.id,'wait-agent',{reason})
        :await action(task.id,'fail',{reason})
      replaceTask(updated)
      message.error(reason)
    }
  }catch(e:any){message.error(apiProblem(e,'正式打印结果写回失败').message)}
  finally{await refreshTasks(true)}
}

function openRetry(task:PrintTask){
  retryTask.value=task
  retryPrinterId.value=task.printerId||onlinePrinters.value[0]?.id||''
  retryOpen.value=true
}

async function confirmRetry(){
  const task=retryTask.value
  if(!task)return
  if(!retryPrinterId.value){message.warning('请选择重试打印机');return}
  retryBusy.value=true
  try{
    const updated=await action(task.id,'retry',{printerId:retryPrinterId.value})
    replaceTask(updated);retryOpen.value=false
    message.success('已创建重试状态；原冻结快照保持不变')
    await openDetail(updated)
  }catch(e:any){message.error(apiProblem(e,'创建重试失败').message)}
  finally{retryBusy.value=false}
}

function recoverUnknownPrint(task:PrintTask){
  Modal.confirm({
    title:'把“打印中”任务转为等待 Agent？',
    content:'该任务已经进入 PRINTING，但平台没有收到最终结果。请先核对打印机是否已经实际出纸，避免重复打印。确认后，本次尝试会记录为 WAITING_AGENT；后续再次执行会生成新的打印尝试，并继续使用原冻结快照。',
    okText:'已核对，转为等待 Agent',
    cancelText:'暂不处理',
    async onOk(){
      try{
        const updated=await action(task.id,'wait-agent',{reason:'正式打印结果未确认；操作员核对后转为等待 Agent'})
        replaceTask(updated)
        message.success('任务已转为等待 Agent')
        await refreshTasks(true)
      }catch(e:any){message.error(apiProblem(e,'任务恢复失败').message)}
    }
  })
}
function openFailureConfirm(task:PrintTask){
  failureTask.value=task
  failureReason.value='已核对打印机，确认本次未成功出纸'
  failureOpen.value=true
}
async function confirmFailure(){
  const task=failureTask.value
  if(!task)return
  if(!failureReason.value.trim()){message.warning('请输入失败原因');return}
  failureBusy.value=true
  try{
    const updated=await action(task.id,'fail',{reason:failureReason.value.trim()})
    replaceTask(updated)
    failureOpen.value=false
    message.success('已确认本次打印失败，可按原冻结快照发起重试')
    await refreshTasks(true)
    await openDetail(updated)
  }catch(e:any){message.error(apiProblem(e,'确认失败失败').message)}
  finally{failureBusy.value=false}
}

function cancelTask(task:PrintTask){
  Modal.confirm({
    title:'取消正式打印任务？',
    content:'取消后任务进入终态，不能再次排队或重试。冻结快照仍保留用于审计。',
    okText:'确认取消',okType:'danger',cancelText:'返回',
    async onOk(){
      try{replaceTask(await action(task.id,'cancel'));message.success('任务已取消');await refreshTasks(true)}
      catch(e:any){message.error(apiProblem(e,'取消任务失败').message)}
    }
  })
}

async function openSpooler(printerId:string){
  spoolerPrinter.value=printerId
  spoolerOpen.value=true
  spoolerBusy.value=true
  spoolerJobs.value=[]
  try{
    spoolerJobs.value=await listSpoolerJobs(printerId)
  }catch(e:any){
    message.error(e?.message||'Windows 打印队列读取失败')
  }finally{spoolerBusy.value=false}
}

function openPrinterManage(printer:{
  id:string;name:string;location:string;enabled:boolean;defaultPrinter:boolean;notes:string;
  offsetXmm:number;offsetYmm:number;scalePercent:number;
  duplexMode:'SIMPLEX'|'LONG_EDGE'|'SHORT_EDGE';colorMode:'AUTO'|'COLOR'|'MONOCHROME';fitMode:'ACTUAL'|'FIT';paperSource:string
}){
  printerManageId.value=printer.id
  printerForm.displayName=printer.name
  printerForm.location=printer.location||''
  printerForm.enabled=printer.enabled
  printerForm.defaultPrinter=printer.defaultPrinter
  printerForm.notes=printer.notes||''
  printerForm.offsetXmm=printer.offsetXmm
  printerForm.offsetYmm=printer.offsetYmm
  printerForm.scalePercent=printer.scalePercent
  printerForm.duplexMode=printer.duplexMode
  printerForm.colorMode=printer.colorMode
  printerForm.fitMode=printer.fitMode
  printerForm.paperSource=printer.paperSource
  printerManageOpen.value=true
}
async function savePrinterManage(){
  if(!printerManageId.value)return
  printerManageBusy.value=true
  try{
    await savePrinterProfile(printerManageId.value,{...printerForm})
    printerProfiles.value=await listPrinterProfiles()
    printerManageOpen.value=false
    message.success('打印机管理配置已保存')
  }catch(e:any){message.error(apiProblem(e,'打印机配置保存失败').message)}
  finally{printerManageBusy.value=false}
}
function printerLabel(printerId?:string|null){
  if(!printerId)return '未指定'
  const p=managedPrinters.value.find(x=>x.id===printerId)
  return p?p.name+' · '+printerId:printerId
}
function printerOptions(printerId?:string|null){
  const p=managedPrinters.value.find(x=>x.id===printerId)
  return {
    duplexMode:p?.duplexMode??'SIMPLEX',
    colorMode:p?.colorMode??'AUTO',
    fitMode:p?.fitMode??'ACTUAL',
    paperSource:p?.paperSource||''
  }
}

function printerCalibration(printerId?:string|null){
  const p=managedPrinters.value.find(x=>x.id===printerId)
  return {offsetXmm:p?.offsetXmm??0,offsetYmm:p?.offsetYmm??0,scalePercent:p?.scalePercent??100}
}

function replaceTask(task:PrintTask){
  const index=tasks.value.findIndex(t=>t.id===task.id)
  if(index>=0)tasks.value.splice(index,1,task)
  if(detailTask.value?.id===task.id)detailTask.value=task
  if(productionTask.value?.id===task.id)productionTask.value=task
}

function taskStatus(value:unknown):PrintTaskStatus{
  return statusOptions.includes(value as PrintTaskStatus)?value as PrintTaskStatus:'CREATED'
}
function taskStatusText(value:unknown){return statusText[taskStatus(value)]}
function taskStatusColor(value:unknown){return statusColor[taskStatus(value)]}
function time(value:string){return value?new Date(value).toLocaleString():'-'}
function duration(attempt:PrintTaskAttempt){
  const a=new Date(attempt.createdAt).getTime(),b=new Date(attempt.updatedAt).getTime()
  return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,b-a)+' ms':'-'
}

onMounted(async()=>{
  await Promise.all([loadTemplates(),loadPlatformManagement(),refreshTasks(),refreshAgent()])
  schedule()
})
onUnmounted(()=>window.clearInterval(timer))
</script>

<template>
  <div class="workbench">
    <div class="page-head">
      <div>
        <span class="eyebrow">PRODUCTION PRINT RUNTIME</span>
        <h1>正式打印工作台</h1>
        <p>正式任务只使用已发布模板和创建时冻结的 renderData；重试不会重新查询业务库。</p>
      </div>
      <a-space>
        <a-switch v-model:checked="autoRefresh" checked-children="自动刷新" un-checked-children="手动"/>
        <a-button :loading="loading||agentLoading" @click="()=>{refreshTasks();refreshAgent();loadPlatformManagement()}">刷新</a-button>
        <a-button @click="openRawCreate">RAW 正式打印</a-button>
        <a-button @click="openPdfCreate">PDF 正式打印</a-button>
        <a-button type="primary" @click="openCreate">＋ 创建正式任务</a-button>
      </a-space>
    </div>

    <a-alert
      v-if="capabilities&&!capabilities.productionActionsProtected"
      type="warning"
      show-icon
      class="permission-alert"
      message="正式打印操作尚未受服务端认证 / RBAC 保护"
      :description="capabilities.warnings.join(' ')"
    />
    <a-alert
      v-else-if="capabilities?.productionActionsProtected"
      type="success"
      show-icon
      class="permission-alert"
      message="正式打印操作已启用服务端权限保护"
    />

    <div class="runtime-grid">
      <a-card class="agent-card">
        <template #title>本地 Agent</template>
        <template #extra><a-button size="small" :loading="agentLoading" @click="refreshAgent">检查</a-button></template>
        <div v-if="agent" class="agent-state">
          <div class="agent-head">
            <a-badge :status="productionReady?'success':'warning'" :text="productionReady?'可执行正式打印':'仅测试 / 未启用物理打印'"/>
            <a-tag>{{agent.adapter}}</a-tag>
          </div>
          <div class="agent-meta">
            <span>状态 <b>{{agent.status}}</b></span><span>打印机 <b>{{agent.printers}}</b></span>
            <span>OS Print <b>{{agent.osPrintEnabled?'ON':'OFF'}}</b></span><span>确认语义 <b>{{agent.executionSemantics||'—'}}</b></span>
          </div>
          <a-alert v-if="!productionReady" type="warning" show-icon message="正式打印已被保护性禁用" description="当前 Agent 没有启用真实 OS 打印适配器。测试打印仍可用，但正式 PrintTask 不会被误标记为成功。"/>
          <a-alert v-else-if="agent.executionSemantics==='COMMAND_EXIT_SUCCESS'" type="info" show-icon message="当前成功语义：打印命令正常退出" description="这表示文档已交给配置的本地打印命令，不等同于打印机已经物理出纸。需要严格物理完成确认时还要接 Windows spooler Job 状态。"/>
        </div>
        <a-alert v-else type="error" show-icon message="Agent / 扩展不可用" :description="agentError||'请确认 Chromium 扩展与本地 Print Agent 已启动。'"/>
      </a-card>

      <a-card class="printer-card">
        <template #title>打印机管理</template>
        <template #extra><span class="printer-count">{{managedPrinters.length}} 台已发现 / 纳管</span></template>
        <a-empty v-if="!managedPrinters.length" description="未发现打印机，也没有平台打印机配置"/>
        <div v-else class="printer-list">
          <div v-for="printer in managedPrinters" :key="printer.id" class="printer-row" :class="{disabled:!printer.enabled}">
            <div class="printer-main">
              <strong>{{printer.name}}</strong>
              <small>{{printer.id}} · {{printer.type}}<template v-if="printer.location"> · {{printer.location}}</template></small>
              <small v-if="printer.agentName&&printer.agentName!==printer.name">Agent 名称：{{printer.agentName}}</small>
            </div>
            <div class="printer-actions">
              <div class="printer-tags">
                <a-tag v-if="printer.defaultPrinter" color="blue">平台默认</a-tag>
                <a-tag v-else-if="printer.agentDefault" color="cyan">Agent 默认</a-tag>
                <a-tag v-if="!printer.managed">未纳管</a-tag>
                <a-tag v-if="!printer.enabled" color="red">平台停用</a-tag>
                <a-tag :color="printer.status==='ONLINE'?'green':printer.status==='ATTENTION'?'orange':'red'">{{printer.status}}</a-tag>
              </div>
              <a-space>
                <a-button v-if="agent?.spoolerMonitoring" size="small" @click="openSpooler(printer.id)">系统队列</a-button>
                <a-button size="small" @click="openPrinterManage(printer)">管理</a-button>
              </a-space>
            </div>
          </div>
        </div>
      </a-card>
    </div>

    <div class="metrics">
      <a-card><span>全部任务</span><strong>{{summary.total}}</strong><em>最近刷新 {{lastRefresh||'-'}}</em></a-card>
      <a-card><span>处理中</span><strong>{{summary.active}}</strong><em>排队 {{summary.queued}} · 打印 {{summary.printing}}</em></a-card>
      <a-card><span>等待 / 失败</span><strong>{{summary.waitingAgent+summary.failed}}</strong><em>Agent {{summary.waitingAgent}} · 失败 {{summary.failed}}<template v-if="stalePrintingCount"> · 待核对 {{stalePrintingCount}}</template></em></a-card>
      <a-card><span>成功</span><strong>{{summary.succeeded}}</strong><em>取消 {{summary.cancelled}}</em></a-card>
    </div>

    <a-card class="task-monitor">
      <template #title>任务监控</template>
      <div class="task-filters">
        <a-input v-model:value="filters.keyword" allow-clear placeholder="任务号 / 业务号 / 模板 / 打印机 / 消息" @pressEnter="refreshTasks"/>
        <a-select v-model:value="filters.status" allow-clear placeholder="全部状态">
          <a-select-option v-for="s in statusOptions" :key="s" :value="s">{{statusText[s]}}</a-select-option>
        </a-select>
        <a-select v-model:value="filters.templateCode" allow-clear show-search placeholder="全部模板">
          <a-select-option v-for="t in publishedTemplates" :key="t.code" :value="t.code">{{t.name}} · {{t.code}}</a-select-option>
        </a-select>
        <a-select v-model:value="filters.printerId" allow-clear placeholder="全部打印机">
          <a-select-option v-for="p in managedPrinters" :key="p.id" :value="p.id">{{p.name}} · {{p.id}}</a-select-option>
        </a-select>
        <a-button type="primary" @click="refreshTasks">筛选</a-button>
        <a-button @click="()=>{filters.status='';filters.templateCode='';filters.printerId='';filters.keyword='';refreshTasks()}">清空</a-button>
      </div>

      <a-table :data-source="tasks" :loading="loading" row-key="id" :pagination="{pageSize:20,showSizeChanger:false}" :scroll="{x:1250}">
        <a-table-column title="任务 / 业务" :width="255">
          <template #default="{record}">
            <strong class="task-id">{{record.id}}</strong>
            <div class="table-sub">{{record.businessKey}}</div>
          </template>
        </a-table-column>
        <a-table-column title="模板版本" :width="190">
          <template #default="{record}">
            {{record.templateCode}}
            <div class="table-sub">v{{record.templateVersion??'-'}}</div>
          </template>
        </a-table-column>
        <a-table-column title="打印机" :width="165">
          <template #default="{record}">{{printerLabel(record.printerId)}}</template>
        </a-table-column>
        <a-table-column title="份数" data-index="copies" :width="65"/>
        <a-table-column title="状态" :width="115">
          <template #default="{record}">
            <a-tag v-if="isStalePrinting(record)" color="orange">打印中 · 结果待核对</a-tag>
            <a-tag v-else :color="taskStatusColor(record.status)">{{taskStatusText(record.status)}}</a-tag>
          </template>
        </a-table-column>
        <a-table-column title="尝试" data-index="attempts" :width="65"/>
        <a-table-column title="消息" :width="220">
          <template #default="{record}"><span :title="record.message">{{record.message||'-'}}</span></template>
        </a-table-column>
        <a-table-column title="更新时间" :width="175">
          <template #default="{record}">{{time(record.updatedAt)}}</template>
        </a-table-column>
        <a-table-column title="操作" fixed="right" :width="245">
          <template #default="{record}">
            <a-space>
              <a-button size="small" @click="openDetail(record)">详情</a-button>
              <a-tooltip v-if="canExecute(record)" :title="productionReady?'使用冻结快照执行正式打印':'Agent 未启用正式打印'">
                <a-button size="small" type="primary" :disabled="!productionReady" @click="openProduction(record)">打印</a-button>
              </a-tooltip>
              <a-button v-if="record.status==='FAILED'" size="small" @click="openRetry(record)">重试</a-button>
              <a-dropdown v-if="isStalePrinting(record)">
                <a-button size="small" danger>异常恢复 ▾</a-button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item @click="recoverUnknownPrint(record)">已核对 · 转等待 Agent</a-menu-item>
                    <a-menu-item danger @click="openFailureConfirm(record)">已核对 · 确认失败</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-button v-if="canCancel(record)" size="small" danger @click="cancelTask(record)">取消</a-button>
            </a-space>
          </template>
        </a-table-column>
      </a-table>
    </a-card>

    <a-modal v-model:open="rawOpen" title="创建 RAW 正式打印任务" :confirm-loading="rawBusy" ok-text="创建并冻结 RAW" width="720px" @ok="submitRawCreate">
      <a-alert type="warning" show-icon message="RAW snapshot 冻结最终字节" description="支持 ESC/POS、ZPL、TSPL、CPCL。请提交最终 Base64；重试沿用同一字节流和 SHA-256。RAW 份数固定为 1，批量份数请由协议本身编码。"/>
      <a-form layout="vertical" style="margin-top:14px">
        <div class="form-two">
          <a-form-item label="标题"><a-input v-model:value="rawForm.title" placeholder="例如 药品标签"/></a-form-item>
          <a-form-item label="协议">
            <a-select v-model:value="rawForm.rawLanguage">
              <a-select-option value="ESC_POS">ESC/POS</a-select-option>
              <a-select-option value="ZPL">ZPL</a-select-option>
              <a-select-option value="TSPL">TSPL</a-select-option>
              <a-select-option value="CPCL">CPCL</a-select-option>
            </a-select>
          </a-form-item>
        </div>
        <a-form-item label="业务唯一号"><a-input v-model:value="rawForm.businessKey" placeholder="例如 LABEL-20260922-001"/></a-form-item>
        <a-form-item label="打印机">
          <a-select v-model:value="rawForm.printerId">
            <a-select-option v-for="p in managedPrinters" :key="p.id" :value="p.id" :disabled="p.status!=='ONLINE'||!p.enabled">{{p.name}} · {{p.status}}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="RAW Base64"><a-textarea v-model:value="rawForm.rawBase64" :rows="9" placeholder="最终指令字节的 Base64"/></a-form-item>
      </a-form>
    </a-modal>

    <a-modal v-model:open="pdfOpen" title="创建 PDF 正式打印任务" :confirm-loading="pdfBusy" ok-text="创建并冻结 PDF" width="680px" @ok="submitPdfCreate">
      <a-alert type="info" show-icon message="PDF 会冻结进 PrintTask snapshot" description="重试继续使用同一份 PDF；最大 20 MB。不会绕开任务审计。"/>
      <a-form layout="vertical" style="margin-top:14px">
        <a-form-item label="PDF 文件">
          <input type="file" accept="application/pdf,.pdf" @change="onPdfFile"/>
          <div v-if="pdfForm.fileName" class="table-sub">{{pdfForm.fileName}}</div>
        </a-form-item>
        <a-form-item label="标题"><a-input v-model:value="pdfForm.title" placeholder="例如 检验报告"/></a-form-item>
        <div class="form-two">
          <a-form-item label="业务唯一号"><a-input v-model:value="pdfForm.businessKey" placeholder="例如 REPORT-20260921-001"/></a-form-item>
          <a-form-item label="份数"><a-input-number v-model:value="pdfForm.copies" :min="1" :max="99" style="width:100%"/></a-form-item>
        </div>
        <a-form-item label="打印机">
          <a-select v-model:value="pdfForm.printerId">
            <a-select-option v-for="p in managedPrinters" :key="p.id" :value="p.id" :disabled="p.status!=='ONLINE'||!p.enabled">{{p.name}} · {{p.status}}</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal v-model:open="createOpen" title="创建正式打印任务" :confirm-loading="createBusy" ok-text="创建并冻结" width="720px" @ok="submitCreate">
      <a-alert type="info" show-icon message="创建时会固定当前已发布模板版本和最终 renderData；之后模板变化、数据库变化都不会改变这个任务。"/>
      <a-form layout="vertical" class="create-form">
        <a-form-item label="已发布模板">
          <a-select v-model:value="createForm.templateCode" show-search>
            <a-select-option v-for="t in publishedTemplates" :key="t.code" :value="t.code">{{t.name}} · {{t.code}} · v{{t.publishedVersion}}</a-select-option>
          </a-select>
        </a-form-item>
        <div class="form-two">
          <a-form-item label="业务唯一号"><a-input v-model:value="createForm.businessKey" placeholder="例如 OP-20260921-001"/></a-form-item>
          <a-form-item label="份数"><a-input-number v-model:value="createForm.copies" :min="1" :max="99" style="width:100%"/></a-form-item>
        </div>
        <a-form-item label="打印机">
          <a-select v-model:value="createForm.printerId" placeholder="选择本地 Agent 发现的打印机">
            <a-select-option v-for="p in managedPrinters" :key="p.id" :value="p.id" :disabled="p.status!=='ONLINE'||!p.enabled">
              {{p.name}} · {{p.status}}{{!p.enabled?' · 平台停用':''}}
            </a-select-option>
          </a-select>
        </a-form-item>
        <template v-if="selectedTemplate?.dataConfig.mode==='SQL'">
          <a-alert type="warning" show-icon message="SQL 正式打印会在创建任务时查询一次业务库，然后冻结结果；重试不会再次查询。"/>
          <a-form-item label="SQL 参数 JSON"><a-textarea v-model:value="createForm.paramsText" :rows="8" placeholder='{"orderId":"SO-001"}'/></a-form-item>
        </template>
        <template v-else>
          <a-alert type="warning" show-icon message="必须提供真实业务 inputData" description="正式任务不会自动使用模板 sampleData。请从业务系统传入或粘贴本次打印的真实 JSON。"/>
          <a-form-item label="业务 inputData JSON"><a-textarea v-model:value="createForm.inputText" :rows="10" placeholder='{"patientName":"...","items":[]}'/></a-form-item>
        </template>
      </a-form>
    </a-modal>

    <a-drawer v-model:open="detailOpen" title="正式任务详情" width="620">
      <a-spin :spinning="detailBusy">
        <template v-if="detailTask">
          <a-descriptions bordered size="small" :column="2">
            <a-descriptions-item label="任务号" :span="2">{{detailTask.id}}</a-descriptions-item>
            <a-descriptions-item label="业务号">{{detailTask.businessKey}}</a-descriptions-item>
            <a-descriptions-item label="状态"><a-tag :color="statusColor[detailTask.status]">{{statusText[detailTask.status]}}</a-tag></a-descriptions-item>
            <a-descriptions-item label="文档">{{detailDocument?.documentKind==='RAW'?'RAW · '+detailDocument.rawLanguage:detailDocument?.documentKind==='PDF'?'PDF':detailTask.templateCode}}</a-descriptions-item>
            <a-descriptions-item label="冻结版本">{{detailDocument?.documentKind==='RAW'?'RAW Snapshot':detailDocument?.documentKind==='PDF'?'PDF Snapshot':'v'+(detailTask.templateVersion??'-')}}</a-descriptions-item>
            <a-descriptions-item label="打印机">{{printerLabel(detailTask.printerId)}}</a-descriptions-item>
            <a-descriptions-item label="份数">{{detailTask.copies}}</a-descriptions-item>
            <a-descriptions-item label="Snapshot ID" :span="2">{{detailTask.snapshotId}}</a-descriptions-item>
            <a-descriptions-item v-if="detailDocument?.documentKind==='RAW'" label="RAW SHA-256" :span="2"><span class="task-id">{{detailDocument.sha256}}</span></a-descriptions-item>
            <a-descriptions-item v-if="detailDocument?.documentKind==='RAW'" label="RAW 字节">{{detailDocument.byteLength??'-'}}</a-descriptions-item>
            <a-descriptions-item label="消息" :span="2">{{detailTask.message||'-'}}</a-descriptions-item>
          </a-descriptions>

          <a-alert v-if="detailDocument" type="info" show-icon class="detail-note"
            :message="'冻结文档：'+detailDocument.templateName+' v'+detailDocument.templateVersion"
            description="详情页默认不展开 renderData，避免操作台无意暴露业务内容；需要核对时使用冻结文档预览。"/>
          <a-button v-if="detailDocument&&detailDocument.documentKind==='TEMPLATE'" @click="()=>{productionTask=detailTask;productionDocument=detailDocument;previewOpen=true}">预览冻结文档</a-button>

          <a-divider>打印尝试</a-divider>
          <a-empty v-if="!attempts.length" description="尚未开始打印"/>
          <a-timeline v-else>
            <a-timeline-item v-for="a in attempts" :key="a.id" :color="a.status==='SUCCESS'?'green':a.status==='FAILED'?'red':'blue'">
              <strong>#{{a.attemptNo}} · {{a.status}}</strong>
              <div>{{a.printerId||'未指定打印机'}} · {{duration(a)}}</div>
              <small>{{time(a.createdAt)}} → {{time(a.updatedAt)}}</small>
              <p v-if="a.message">{{a.message}}</p>
              <template v-if="a.spoolerJobId!=null">
                <p>Windows Job #{{a.spoolerJobId}} · {{a.spoolerStatus||'UNKNOWN'}} · {{a.spoolerDocumentName}}</p>
                <a-space v-if="detailTask?.status==='PRINTING'">
                  <a-button size="small" @click="reconcileSpooler(detailTask!)">同步状态</a-button>
                  <a-button size="small" :disabled="a.spoolerStatus==='PAUSED'" @click="controlBoundJob(detailTask!,'pause')">暂停</a-button>
                  <a-button size="small" :disabled="a.spoolerStatus!=='PAUSED'" @click="controlBoundJob(detailTask!,'resume')">恢复</a-button>
                  <a-button size="small" danger @click="controlBoundJob(detailTask!,'cancel')">取消 Job</a-button>
                </a-space>
              </template>
            </a-timeline-item>
          </a-timeline>
        </template>
      </a-spin>
    </a-drawer>

    <a-drawer v-model:open="spoolerOpen" title="Windows 打印队列" width="720">
      <a-alert
        type="info"
        show-icon
        :message="'打印机：'+printerLabel(spoolerPrinter)"
        description="这里读取 Windows Spooler 当前 Job。队列为空只表示当前没有可见后台 Job；命令提交成功仍不等同于已经物理出纸。"
        style="margin-bottom:12px"
      />
      <a-button size="small" :loading="spoolerBusy" @click="openSpooler(spoolerPrinter)">刷新队列</a-button>
      <a-table :data-source="spoolerJobs" :loading="spoolerBusy" row-key="id" :pagination="false" style="margin-top:12px">
        <a-table-column title="Job" data-index="id" :width="80"/>
        <a-table-column title="文档" data-index="documentName"/>
        <a-table-column title="状态" data-index="status" :width="140"/>
        <a-table-column title="页数" :width="100">
          <template #default="{record}">{{record.pagesPrinted??0}} / {{record.totalPages??'?'}}</template>
        </a-table-column>
        <a-table-column title="大小" :width="100">
          <template #default="{record}">{{record.size==null?'—':Math.round(record.size/1024)+' KB'}}</template>
        </a-table-column>
      </a-table>
      <a-empty v-if="!spoolerBusy&&!spoolerJobs.length" description="当前没有可见的 Windows 打印 Job"/>
    </a-drawer>

    <a-modal
      v-model:open="failureOpen"
      title="确认本次正式打印失败"
      :confirm-loading="failureBusy"
      ok-text="确认失败"
      ok-type="danger"
      @ok="confirmFailure"
    >
      <a-alert
        type="error"
        show-icon
        message="只有确认本次没有成功出纸时才标记 FAILED"
        description="如果实际纸面结果不确定，请使用“转等待 Agent”，不要直接重试。重复打印可能造成重复票据或重复业务单据。"
      />
      <a-form layout="vertical" style="margin-top:12px">
        <a-form-item label="失败原因"><a-textarea v-model:value="failureReason" :rows="3"/></a-form-item>
      </a-form>
    </a-modal>

    <a-modal v-model:open="retryOpen" title="失败任务重试" :confirm-loading="retryBusy" ok-text="创建重试" @ok="confirmRetry">
      <a-alert type="warning" show-icon message="重试不会重新查询业务数据库" description="系统会沿用原任务冻结的模板版本和 renderData。只允许重新选择执行打印机。"/>
      <a-form layout="vertical" style="margin-top:12px">
        <a-form-item label="重试打印机">
          <a-select v-model:value="retryPrinterId">
            <a-select-option v-for="p in managedPrinters" :key="p.id" :value="p.id" :disabled="p.status!=='ONLINE'||!p.enabled">
              {{p.name}} · {{p.status}}{{!p.enabled?' · 平台停用':''}}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="printerManageOpen"
      title="管理打印机"
      :confirm-loading="printerManageBusy"
      ok-text="保存配置"
      width="560px"
      @ok="savePrinterManage"
    >
      <a-alert
        type="info"
        show-icon
        message="平台配置与 Agent 设备状态是两层信息"
        description="ONLINE / ATTENTION / OFFLINE 来自本地 Agent；别名、位置、启停和默认打印机由平台保存。平台停用后，即使 Agent 仍在线，也不能创建或排队正式任务。"
      />
      <a-form layout="vertical" style="margin-top:14px">
        <a-form-item label="Printer ID"><a-input :value="printerManageId" disabled/></a-form-item>
        <a-form-item label="显示名称"><a-input v-model:value="printerForm.displayName" placeholder="例如 收费处 A4 主打印机"/></a-form-item>
        <a-form-item label="位置"><a-input v-model:value="printerForm.location" placeholder="例如 门诊一楼收费 03 窗口"/></a-form-item>
        <div class="form-two">
          <a-form-item label="平台启用"><a-switch v-model:checked="printerForm.enabled"/></a-form-item>
          <a-form-item label="设为平台默认">
            <a-switch v-model:checked="printerForm.defaultPrinter" :disabled="!printerForm.enabled"/>
          </a-form-item>
        </div>
        <a-divider>套打校准</a-divider>
        <a-alert type="info" show-icon message="校准只作用于这台打印机，不修改模板" description="先用 0 / 0 / 100% 打印测试页，再根据物理偏差微调。X/Y 支持 -20～20mm，缩放支持 80～120%。"/>
        <div class="calibration-grid">
          <a-form-item label="X 偏移 mm"><a-input-number v-model:value="printerForm.offsetXmm" :min="-20" :max="20" :step="0.5" style="width:100%"/></a-form-item>
          <a-form-item label="Y 偏移 mm"><a-input-number v-model:value="printerForm.offsetYmm" :min="-20" :max="20" :step="0.5" style="width:100%"/></a-form-item>
          <a-form-item label="缩放 %"><a-input-number v-model:value="printerForm.scalePercent" :min="80" :max="120" :step="0.5" style="width:100%"/></a-form-item>
        </div>
        <a-divider>驱动默认参数</a-divider>
        <div class="driver-grid">
          <a-form-item label="单双面">
            <a-select v-model:value="printerForm.duplexMode">
              <a-select-option value="SIMPLEX">单面</a-select-option>
              <a-select-option value="LONG_EDGE">双面 · 长边翻转</a-select-option>
              <a-select-option value="SHORT_EDGE">双面 · 短边翻转</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="颜色">
            <a-select v-model:value="printerForm.colorMode">
              <a-select-option value="AUTO">自动</a-select-option>
              <a-select-option value="COLOR">彩色</a-select-option>
              <a-select-option value="MONOCHROME">黑白</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="缩放策略">
            <a-select v-model:value="printerForm.fitMode">
              <a-select-option value="ACTUAL">实际尺寸</a-select-option>
              <a-select-option value="FIT">适应纸张</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="纸盒 / Paper Source"><a-input v-model:value="printerForm.paperSource" placeholder="例如 Tray 1"/></a-form-item>
        </div>
        <a-form-item label="运维备注"><a-textarea v-model:value="printerForm.notes" :rows="3" placeholder="设备型号、纸张规格、责任人等非敏感备注"/></a-form-item>
      </a-form>
    </a-modal>

    <PreviewModal
      v-if="productionTemplate&&productionDocument"
      v-model:open="previewOpen"
      :template="productionTemplate"
      :render-data="productionDocument.renderData"
      :show-reference="false"
      :context="{label:'正式任务冻结数据'}"
      :production-print="productionTask?.printerId&&canExecute(productionTask)?{
        taskId:productionTask.id,
        printerId:productionTask.printerId,
        copies:productionTask.copies,
        prepare:prepareProduction,
        calibration:printerCalibration(productionTask.printerId),
        printOptions:printerOptions(productionTask.printerId)
      }:null"
      @production-result="onProductionResult"
    />
  </div>
</template>

<style scoped>
.workbench{min-width:0}.permission-alert{margin-bottom:16px}.runtime-grid{display:grid;grid-template-columns:minmax(360px,.9fr) minmax(480px,1.1fr);gap:16px;margin-bottom:16px}.agent-card,.printer-card,.task-monitor{border-radius:18px}.agent-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.agent-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}.agent-meta span{padding:9px;border-radius:9px;background:#f6faff;color:#6f879b;font-size:12px}.agent-meta b{display:block;color:#17365f;margin-top:3px}.printer-list{display:grid;gap:7px}.printer-count{font-size:12px;color:#8295a5}.printer-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 10px;border:1px solid #e1edf5;border-radius:10px}.printer-row.disabled{background:#fff7f6;border-color:#ffd8d3}.printer-main{min-width:0}.printer-row strong,.printer-row small{display:block}.printer-row small{margin-top:3px;color:#8195a6;font-family:Consolas,monospace}.printer-actions{display:flex;align-items:center;gap:8px}.printer-tags{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:3px}.task-filters{display:grid;grid-template-columns:minmax(240px,1.4fr) 145px 220px 190px auto auto;gap:8px;margin-bottom:12px}.task-id{font-family:Consolas,monospace;font-size:12px}.create-form{margin-top:14px}.form-two{display:grid;grid-template-columns:1fr 120px;gap:10px}.detail-note{margin:14px 0 10px}.calibration-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.driver-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ant-timeline p{margin:4px 0;color:#667d91}.ant-timeline small{color:#91a2b0}
@media(max-width:1250px){.runtime-grid{grid-template-columns:1fr}.task-filters{grid-template-columns:1fr 1fr 1fr}}
@media(max-width:800px){.task-filters,.form-two,.calibration-grid,.driver-grid{grid-template-columns:1fr}.agent-meta{grid-template-columns:1fr 1fr}}
</style>
