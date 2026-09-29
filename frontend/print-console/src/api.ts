import axios from 'axios'
import type {
  AiLayoutResponse,AuthSession,CloudTemplateBundle,CloudTemplateCatalogStatus,CloudTemplateSummary,ConnectionTestResult,CreatePdfPrintTaskInput,CreatePrintTaskInput,CreateRawPrintTaskInput,DataSourceConnection,DatabaseType,DocumentType,
  PrintTask,PrintTaskAttempt,PrintTaskDocument,PrintTaskSummary,PrintTemplate,PrintTemplateVersion,PrinterProfile,RuntimeCapabilities,ReleaseScope,ReportDailyRow,ReportLogRow,ReportPrinterRow,ReportSummary,ReportTemplateRow,TemplateAiTask,TemplateAuditEvent,
  TemplateDataConfig,TemplateDesign,TemplateInstallation,TemplateInstallationResponse,TemplateRelease,TemplateValidationResult,
  TemplateTestRequest,QueryTestResponse,TestDataResponse,TemplateTestRunSummary,TemplateTestRunDetail,SystemLogEntry,SystemLogPage,SystemLogQuery,SystemLogCleanupResult,AgentInstanceRecord,AgentHeartbeatRecord,AgentPrinterRecord,AlertRule,AlertEvent,AlertPage,AlertQuery
} from './types'
const api=axios.create({baseURL:'/api'})
const API_KEY_STORAGE='print-platform-api-key'

export function getStoredPlatformApiKey():string{
  return typeof localStorage==='undefined'?'':(localStorage.getItem(API_KEY_STORAGE)||'')
}
export function setPlatformApiKey(value:string){
  if(typeof localStorage==='undefined')return
  const next=value.trim()
  if(next)localStorage.setItem(API_KEY_STORAGE,next)
  else localStorage.removeItem(API_KEY_STORAGE)
}
export function clearPlatformApiKey(){setPlatformApiKey('')}

api.interceptors.request.use(config=>{
  const key=getStoredPlatformApiKey()
  if(key)config.headers.Authorization='Bearer '+key
  return config
})

export async function getAuthSession():Promise<AuthSession>{
  return (await api.get<AuthSession>('/auth/session')).data
}

export async function listTasks(params:{status?:string;templateCode?:string;printerId?:string;keyword?:string;limit?:number}={}):Promise<PrintTask[]>{
  return (await api.get<PrintTask[]>('/print-tasks',{params})).data
}
export async function getTaskSummary():Promise<PrintTaskSummary>{return (await api.get<PrintTaskSummary>('/print-tasks/summary')).data}
export async function getTaskDocument(taskId:string):Promise<PrintTaskDocument>{return (await api.get<PrintTaskDocument>('/print-tasks/'+taskId+'/document')).data}
export async function getTaskAttempts(taskId:string):Promise<PrintTaskAttempt[]>{return (await api.get<PrintTaskAttempt[]>('/print-tasks/'+taskId+'/attempts')).data}
export async function createTask(input:CreatePrintTaskInput):Promise<PrintTask>{return (await api.post<PrintTask>('/print-tasks',input)).data}
export async function createRawTask(input:CreateRawPrintTaskInput):Promise<PrintTask>{return (await api.post<PrintTask>('/print-tasks/raw',input)).data}
export async function bindSpooler(taskId:string,input:{agentJobId:string;spoolerJobId:number;documentName:string;spoolerStatus:string;boundAt:string}):Promise<PrintTaskAttempt>{
  return (await api.post<PrintTaskAttempt>('/print-tasks/'+taskId+'/spooler-binding',input)).data
}
export async function updateSpoolerStatus(taskId:string,spoolerStatus:string):Promise<PrintTaskAttempt>{
  return (await api.post<PrintTaskAttempt>('/print-tasks/'+taskId+'/spooler-status',{spoolerStatus})).data
}
export async function action(taskId:string,name:string,body?:unknown):Promise<PrintTask>{return (await api.post<PrintTask>('/print-tasks/'+taskId+'/'+name,body)).data}

export async function listConnections():Promise<DataSourceConnection[]>{return (await api.get<DataSourceConnection[]>('/data-sources/connections')).data}
export async function createConnection(input:{name:string;dbType:DatabaseType;jdbcUrl:string;username?:string;secretRef?:string;readOnly:boolean;enabled:boolean}):Promise<DataSourceConnection>{return (await api.post<DataSourceConnection>('/data-sources/connections',input)).data}
export async function testConnection(input:{dbType:DatabaseType;jdbcUrl:string;username?:string;password?:string;readOnly:boolean}):Promise<ConnectionTestResult>{return (await api.post<ConnectionTestResult>('/data-sources/connections/test',input)).data}

export async function listTemplates():Promise<PrintTemplate[]>{return (await api.get<PrintTemplate[]>('/templates')).data}
export async function getTemplate(id:string):Promise<PrintTemplate>{return (await api.get<PrintTemplate>('/templates/'+id)).data}
export async function createTemplate(input:{code:string;name:string;documentType:DocumentType}):Promise<PrintTemplate>{return (await api.post<PrintTemplate>('/templates',input)).data}
export async function saveTemplateDraft(id:string,input:{name:string;design:TemplateDesign;sampleData:Record<string,unknown>;dataConfig:TemplateDataConfig}):Promise<PrintTemplate>{return (await api.put<PrintTemplate>('/templates/'+id+'/draft',input)).data}
export async function markTemplateTesting(id:string):Promise<PrintTemplate>{return (await api.post<PrintTemplate>('/templates/'+id+'/testing')).data}
export async function validateTemplate(id:string):Promise<TemplateValidationResult>{return (await api.get<TemplateValidationResult>('/templates/'+id+'/validate')).data}
export async function publishTemplate(id:string,changeNote='',scope:ReleaseScope={type:'ALL',values:[]}):Promise<PrintTemplate>{return (await api.post<PrintTemplate>('/templates/'+id+'/publish',{changeNote,scope})).data}
export async function submitTemplateReview(id:string):Promise<PrintTemplate>{return (await api.post<PrintTemplate>('/templates/'+id+'/submit-review')).data}
export async function rollbackTemplate(id:string,versionNo:number,changeNote='',scope:ReleaseScope={type:'ALL',values:[]}):Promise<PrintTemplate>{return (await api.post<PrintTemplate>('/templates/'+id+'/rollback',{versionNo,changeNote,scope})).data}
export async function disableTemplate(id:string):Promise<PrintTemplate>{return (await api.post<PrintTemplate>('/templates/'+id+'/disable')).data}
export async function cloneTemplate(id:string):Promise<PrintTemplate>{return (await api.post<PrintTemplate>('/templates/'+id+'/clone')).data}
export async function listTemplateVersions(id:string):Promise<PrintTemplateVersion[]>{return (await api.get<PrintTemplateVersion[]>('/templates/'+id+'/versions')).data}
export async function listTemplateReleases(id:string):Promise<TemplateRelease[]>{return (await api.get<TemplateRelease[]>('/templates/'+id+'/releases')).data}
export async function listTemplateAudit(id:string):Promise<TemplateAuditEvent[]>{return (await api.get<TemplateAuditEvent[]>('/templates/'+id+'/audit')).data}

export async function recognizeTemplateLayout(id:string,input:{imageDataUrl:string;paperWidth:number;paperHeight:number;sensitiveImageConfirmed:boolean;hint?:string}):Promise<AiLayoutResponse>{return (await api.post<AiLayoutResponse>('/templates/'+id+'/ai-layout',input)).data}
export async function listTemplateAiTasks(id:string):Promise<TemplateAiTask[]>{return (await api.get<TemplateAiTask[]>('/templates/'+id+'/ai-layout/tasks')).data}

export async function getReportSummary(from?:string,to?:string):Promise<ReportSummary>{return (await api.get<ReportSummary>('/reports/summary',{params:{from,to}})).data}
export async function getReportDaily(from?:string,to?:string):Promise<ReportDailyRow[]>{return (await api.get<ReportDailyRow[]>('/reports/daily',{params:{from,to}})).data}
export async function getReportPrinters(from?:string,to?:string):Promise<ReportPrinterRow[]>{return (await api.get<ReportPrinterRow[]>('/reports/printers',{params:{from,to}})).data}
export async function getReportTemplates(from?:string,to?:string):Promise<ReportTemplateRow[]>{return (await api.get<ReportTemplateRow[]>('/reports/templates',{params:{from,to}})).data}
export async function getReportLogs(params:{from?:string;to?:string;status?:string;keyword?:string;limit?:number}):Promise<ReportLogRow[]>{return (await api.get<ReportLogRow[]>('/reports/logs',{params})).data}


export async function testTemplateQuery(id:string,queryId:string,input:TemplateTestRequest):Promise<QueryTestResponse>{
  return (await api.post<QueryTestResponse>('/templates/'+id+'/queries/'+queryId+'/test',input)).data
}
export async function createPdfTask(input:CreatePdfPrintTaskInput):Promise<PrintTask>{
  return (await api.post<PrintTask>('/print-tasks/pdf',input)).data
}

export async function prepareTemplateTestData(id:string,input:TemplateTestRequest):Promise<TestDataResponse>{
  return (await api.post<TestDataResponse>('/templates/'+id+'/test-data',input)).data
}
export async function prepareSimulatedPrint(id:string,input:TemplateTestRequest):Promise<TestDataResponse>{
  return (await api.post<TestDataResponse>('/templates/'+id+'/tests/simulated-print',input)).data
}
export async function preparePluginPrint(id:string,input:TemplateTestRequest):Promise<TestDataResponse>{
  return (await api.post<TestDataResponse>('/templates/'+id+'/tests/plugin-print',input)).data
}
export async function reportTemplateRenderResult(testRunId:string,input:{success:boolean;pageCount?:number|null;elapsedMs:number;message?:string|null}):Promise<TemplateTestRunDetail>{
  return (await api.post<TemplateTestRunDetail>('/template-test-runs/'+testRunId+'/render-result',input)).data
}
export async function reportTemplatePrintResult(testRunId:string,input:{channel:'SIMULATED'|'BROWSER_EXTENSION_AGENT';success:boolean;printerId?:string|null;agentJobId?:string|null;elapsedMs:number;message?:string|null}):Promise<TemplateTestRunDetail>{
  return (await api.post<TemplateTestRunDetail>('/template-test-runs/'+testRunId+'/print-result',input)).data
}
export async function listTemplateTestRuns(id:string,params:{status?:string;testType?:string;dataMode?:string;from?:string;to?:string;limit?:number}={}):Promise<TemplateTestRunSummary[]>{
  return (await api.get<TemplateTestRunSummary[]>('/templates/'+id+'/test-runs',{params})).data
}
export async function getTemplateTestRun(testRunId:string):Promise<TemplateTestRunDetail>{
  return (await api.get<TemplateTestRunDetail>('/template-test-runs/'+testRunId)).data
}


export async function listPrinterProfiles():Promise<PrinterProfile[]>{
  return (await api.get<PrinterProfile[]>('/printers')).data
}
export async function savePrinterProfile(printerId:string,input:{
  displayName?:string;location?:string;enabled:boolean;defaultPrinter:boolean;notes?:string;
  offsetXmm?:number;offsetYmm?:number;scalePercent?:number;
  duplexMode?:'SIMPLEX'|'LONG_EDGE'|'SHORT_EDGE';colorMode?:'AUTO'|'COLOR'|'MONOCHROME';fitMode?:'ACTUAL'|'FIT';paperSource?:string
}):Promise<PrinterProfile>{
  return (await api.put<PrinterProfile>('/printers/'+encodeURIComponent(printerId),input)).data
}
export async function getRuntimeCapabilities():Promise<RuntimeCapabilities>{
  return (await api.get<RuntimeCapabilities>('/runtime/capabilities')).data
}


export async function getCloudTemplateStatus():Promise<CloudTemplateCatalogStatus>{
  return (await api.get<CloudTemplateCatalogStatus>('/cloud-templates/status')).data
}
export async function listCloudTemplates():Promise<CloudTemplateSummary[]>{
  return (await api.get<CloudTemplateSummary[]>('/cloud-templates')).data
}
export async function getCloudTemplate(code:string,versionNo:number):Promise<CloudTemplateBundle>{
  return (await api.get<CloudTemplateBundle>('/cloud-templates/'+encodeURIComponent(code)+'/versions/'+versionNo)).data
}
export async function uploadCloudTemplate(templateId:string,input:{accessModel:'FREE'|'SUBSCRIPTION';productCode?:string;planCode?:string;cloneAllowed?:boolean}={accessModel:'FREE'}):Promise<CloudTemplateSummary>{
  return (await api.post<CloudTemplateSummary>('/cloud-templates/upload/'+templateId,input)).data
}
export async function listTemplateInstallations():Promise<TemplateInstallation[]>{
  return (await api.get<TemplateInstallation[]>('/template-installations')).data
}
export async function installCloudTemplate(code:string,versionNo:number):Promise<TemplateInstallationResponse>{
  return (await api.post<TemplateInstallationResponse>('/template-installations/cloud/'+encodeURIComponent(code)+'/versions/'+versionNo)).data
}
export async function refreshTemplateLicense(localTemplateId:string):Promise<TemplateInstallation>{
  return (await api.post<TemplateInstallation>('/template-installations/'+encodeURIComponent(localTemplateId)+'/refresh-license')).data
}


export async function listSystemLogs(params:SystemLogQuery={}):Promise<SystemLogPage>{
  return (await api.get<SystemLogPage>('/system-logs',{params})).data
}
export async function getSystemLog(id:number):Promise<SystemLogEntry>{
  return (await api.get<SystemLogEntry>('/system-logs/'+id)).data
}
export async function resolveSystemLog(id:number):Promise<SystemLogEntry>{
  return (await api.post<SystemLogEntry>('/system-logs/'+id+'/resolve')).data
}
export async function cleanupSystemLogs():Promise<SystemLogCleanupResult>{
  return (await api.post<SystemLogCleanupResult>('/system-logs/cleanup')).data
}


export async function listAgentInstances():Promise<AgentInstanceRecord[]>{
  return (await api.get<AgentInstanceRecord[]>('/agents')).data
}
export async function listAgentHeartbeats(agentId:string,instanceId:string,limit=120):Promise<AgentHeartbeatRecord[]>{
  return (await api.get<AgentHeartbeatRecord[]>('/agents/'+encodeURIComponent(agentId)+'/instances/'+encodeURIComponent(instanceId)+'/heartbeats',{params:{limit}})).data
}
export async function listAgentPrinters(agentId:string,instanceId:string):Promise<AgentPrinterRecord[]>{
  return (await api.get<AgentPrinterRecord[]>('/agents/'+encodeURIComponent(agentId)+'/instances/'+encodeURIComponent(instanceId)+'/printers')).data
}
export async function getAgentPrinter(agentId:string,instanceId:string,printerId:string):Promise<AgentPrinterRecord>{
  return (await api.get<AgentPrinterRecord>('/agents/'+encodeURIComponent(agentId)+'/instances/'+encodeURIComponent(instanceId)+'/printers/detail',{params:{printerId}})).data
}
export async function listAlertRules():Promise<AlertRule[]>{
  return (await api.get<AlertRule[]>('/alerts/rules')).data
}
export async function setAlertRuleEnabled(code:string,enabled:boolean):Promise<AlertRule>{
  return (await api.post<AlertRule>('/alerts/rules/'+encodeURIComponent(code)+'/enabled',null,{params:{enabled}})).data
}
export async function listAlerts(params:AlertQuery={}):Promise<AlertPage>{
  return (await api.get<AlertPage>('/alerts',{params})).data
}
export async function acknowledgeAlert(id:number):Promise<AlertEvent>{
  return (await api.post<AlertEvent>('/alerts/'+id+'/ack')).data
}
export async function resolveAlert(id:number):Promise<AlertEvent>{
  return (await api.post<AlertEvent>('/alerts/'+id+'/resolve')).data
}
