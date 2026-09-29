export type PrintTaskStatus='CREATED'|'QUEUED'|'PRINTING'|'SUCCESS'|'FAILED'|'RETRYING'|'WAITING_AGENT'|'CANCELLED'
export interface PrintTask {
  id:string;templateCode:string;templateVersion?:number|null;businessKey:string;snapshotId:string;
  printerId?:string|null;copies:number;status:PrintTaskStatus;attempts:number;message?:string|null;createdAt:string;updatedAt:string
}
export interface PrintTaskAttempt {
  id:number;taskId:string;attemptNo:number;printerId?:string|null;status:string;message?:string|null;
  agentJobId?:string|null;spoolerJobId?:number|null;spoolerDocumentName?:string|null;spoolerStatus?:string|null;
  spoolerBoundAt?:string|null;spoolerLastObservedAt?:string|null;createdAt:string;updatedAt:string
}
export interface PrintTaskSummary {
  total:number;created:number;queued:number;printing:number;succeeded:number;failed:number;
  retrying:number;waitingAgent:number;cancelled:number;active:number
}
export interface PrintTaskDocument {
  taskId:string;templateCode:string;templateVersion?:number|null;templateName:string;documentType:DocumentType|'PDF';
  documentKind:'TEMPLATE'|'PDF'|'RAW';
  businessKey:string;printerId?:string|null;copies:number;
  design?:TemplateDesign|null;renderData?:Record<string,unknown>|null;pdfBase64?:string|null;
  rawLanguage?:'ESC_POS'|'ZPL'|'TSPL'|'CPCL'|null;rawBase64?:string|null;byteLength?:number|null;sha256?:string|null;createdAt:string
}
export interface CreatePrintTaskInput {
  templateCode:string;businessKey:string;printerId?:string|null;copies:number;
  params?:Record<string,unknown>|null;inputData?:Record<string,unknown>|null
}
export interface CreatePdfPrintTaskInput {
  title:string;businessKey:string;printerId:string;copies:number;pdfBase64:string
}
export interface CreateRawPrintTaskInput {
  title:string;businessKey:string;printerId:string;copies:1;
  rawLanguage:'ESC_POS'|'ZPL'|'TSPL'|'CPCL';rawBase64:string
}

export type DatabaseType='SQLITE'|'MYSQL'|'POSTGRESQL'|'SQL_SERVER'|'ORACLE'
export interface DataSourceConnection {id:string;name:string;dbType:DatabaseType;jdbcUrl:string;username?:string;secretRef?:string;readOnly:boolean;enabled:boolean;createdAt:string;updatedAt:string}
export interface ConnectionTestResult {success:boolean;databaseProduct?:string;databaseVersion?:string;message:string;elapsedMs:number}

export type TemplateStatus='DRAFT'|'TESTING'|'REVIEWING'|'PUBLISHED'|'DISABLED'
export type TemplateDataMode='JSON'|'SQL'
export type TemplateQueryResultType='OBJECT'|'ARRAY'|'SCALAR'
export type TemplateQueryParamType='STRING'|'INTEGER'|'DECIMAL'|'BOOLEAN'|'DATE'|'DATETIME'
export interface TemplateQueryParam {name:string;type:TemplateQueryParamType;required:boolean;defaultValue?:unknown}
export interface TemplateQueryConfig {queryId:string;name:string;connectionId:string;sql:string;params:TemplateQueryParam[];resultKey:string;resultType:TemplateQueryResultType;order:number;enabled:boolean;timeoutMs?:number;maxRows?:number}
export interface TemplateDataConfig {schemaVersion:1;mode:TemplateDataMode;queries:TemplateQueryConfig[]}
export type DocumentType='FORM'|'INVOICE'|'RECEIPT'|'EXPENSE_LIST'|'POS_RECEIPT'|'LABEL'|'REPORT'
export type TemplateElementType='TEXT'|'LONG_TEXT'|'TITLE'|'IMAGE'|'LINE'|'RECT'|'TABLE'|'BARCODE'|'QRCODE'|'DATE'|'PAGE'|'AMOUNT'|'HEADER'|'FOOTER'|'WATERMARK'
export type HorizontalAlign='left'|'center'|'right'
export type VerticalAlign='top'|'middle'|'bottom'

export interface ElementStyle {
  fontFamily:string
  fontWeight:string
  fontStyle:string
  textDecoration:string
  color:string
  background:string
  borderColor:string
  borderWidth:number
  textAlign:HorizontalAlign
  verticalAlign:VerticalAlign
  opacity:number
  rotation:number
}

export interface TableColumn {
  key:string
  label:string
  width:number
  align:HorizontalAlign
  aggregate?:'SUM'|'COUNT'|'AVG'|'NONE'
  format?:'TEXT'|'NUMBER'|'CURRENCY'|'DATE'
  hidden?:boolean
}
export interface TableHeaderCell {text:string;colSpan:number;rowSpan:number;startColumn:number}
export interface TableHeaderRow {cells:TableHeaderCell[]}
export interface TableMerge {row:number;column:number;rowSpan:number;colSpan:number}
export interface TableConfig {
  columns:TableColumn[]
  headerRows?:TableHeaderRow[]
  merges?:TableMerge[]
  rowHeight:number
  pageRows:number
  repeatHeader:boolean
  hideWhenEmpty:boolean
  fixedTotal:boolean
  showPageSubtotal?:boolean
  groupBy?:string
  subtotalFields?:string[]
  totalFields?:string[]
  showGrandTotal:boolean
}

export interface ReferencePoint {x:number;y:number}
export type ReferenceViewMode='corrected'|'original'|'overlay'|'difference'
export interface ReferenceImage {
  originalDataUrl:string
  correctedDataUrl:string
  fileName:string
  corners:ReferencePoint[]
  rotation:number
  opacity:number
  locked:boolean
  viewMode:ReferenceViewMode
  paperWidth:number
  paperHeight:number
  dpi:number
  sensitiveConfirmed:boolean
  detectedAutomatically:boolean
  updatedAt:string
}
export interface AiCandidate {
  id:string
  type:TemplateElementType
  x:number;y:number;w:number;h:number
  text?:string
  binding?:string
  confidence?:number
  confirmed?:boolean
  style?:Partial<ElementStyle>
}
export interface AiRecognitionState {
  taskId?:string
  status?:string
  provider?:string
  model?:string
  candidates:AiCandidate[]
  lastMessage?:string
  updatedAt?:string
}

export interface TemplatePaper {
  size:string
  width:number
  height:number
  orientation:'PORTRAIT'|'LANDSCAPE'
  marginTop:number
  marginRight:number
  marginBottom:number
  marginLeft:number
  dpi?:number
  autoHeight?:boolean
  autoHeightMaxMm?:number
}
export interface TemplateElement {
  id:string
  type:TemplateElementType
  x:number;y:number;w:number;h:number
  text:string
  binding?:string
  visible:boolean
  locked:boolean
  fontSize:number
  zIndex:number
  src?:string
  barcodeFormat?:string
  style:ElementStyle
  table?:TableConfig
}
export interface TemplateDesign {
  paper:TemplatePaper
  grid:boolean
  snap:boolean
  elements:TemplateElement[]
  referenceImage?:ReferenceImage
  ai?:AiRecognitionState
}
export interface PrintTemplate {
  id:string
  code:string
  name:string
  documentType:DocumentType
  status:TemplateStatus
  draftRevision:number
  publishedVersion?:number
  design:TemplateDesign
  sampleData:Record<string,unknown>
  dataConfig:TemplateDataConfig
  createdAt:string
  updatedAt:string
}
export interface PrintTemplateVersion {id:string;templateId:string;versionNo:number;design:TemplateDesign;sampleData:Record<string,unknown>;dataConfig:TemplateDataConfig;changeNote?:string;createdAt:string}

export type ReleaseScopeType='ALL'|'ORG'|'CAMPUS'|'DEPARTMENT'|'TERMINAL'
export interface ReleaseScope {type:ReleaseScopeType;values:string[]}
export interface TemplateRelease {id:string;templateId:string;versionNo:number;scopeType:ReleaseScopeType;scopeValues:string[];rollbackFromVersion?:number;active:boolean;createdAt:string}
export interface TemplateAuditEvent {id:number;templateId:string;action:string;detail:Record<string,unknown>;createdAt:string}
export interface TemplateValidationResult {valid:boolean;errors:string[];warnings:string[]}
export interface AiLayoutResponse {taskId:string;status:string;provider:string;model:string;candidates:AiCandidate[];message:string}
export interface TemplateAiTask {id:string;templateId:string;provider:string;model:string;status:string;request:Record<string,unknown>;result:Record<string,unknown>|AiCandidate[];errorMessage?:string;createdAt:string;updatedAt:string}

export interface ReportSummary {from:string;to:string;total:number;succeeded:number;failed:number;cancelled:number;active:number;attempts:number;successRate:number}
export interface ReportDailyRow {date:string;total:number;succeeded:number;failed:number;cancelled:number;successRate:number}
export interface ReportPrinterRow {printerId:string;total:number;succeeded:number;failed:number;successRate:number;lastPrintAt:string|null}
export interface ReportTemplateRow {templateCode:string;total:number;succeeded:number;failed:number;successRate:number;lastPrintAt:string|null}
export interface ReportLogRow {createdAt:string;taskId:string;templateCode:string;businessKey:string;attemptNo:number;printerId:string|null;status:string;message:string|null}


export interface TemplateTestTarget {kind:'DRAFT'|'VERSION';draftRevision:number|null;versionNo:number|null}
export interface TemplateSnapshot {templateId:string;code:string;name:string;documentType:DocumentType;design:TemplateDesign}
export interface QueryExecutionSummary {
  queryId:string;name?:string|null;resultKey?:string|null;resultType?:TemplateQueryResultType|null;
  status:'PENDING'|'RUNNING'|'SUCCESS'|'FAILED'|'SKIPPED';rowCount?:number|null;elapsedMs?:number|null;
  errorCode?:string|null;errorMessage?:string|null
}
export interface TemplateTestError {code:string;message:string}
export interface TemplateTestRequest {
  versionNo?:number|null
  params?:Record<string,unknown>
  inputData?:Record<string,unknown>|null
  printerId?:string|null
}
export interface QueryTestResponse {
  testRunId:string;status:'RUNNING'|'SUCCESS'|'FAILED';target:TemplateTestTarget;
  query?:QueryExecutionSummary|null;result?:unknown;error?:TemplateTestError|null
}
export interface TestDataResponse {
  testRunId:string;status:'RUNNING'|'SUCCESS'|'FAILED';dataMode:TemplateDataMode;target:TemplateTestTarget;
  templateSnapshot:TemplateSnapshot;renderData:Record<string,unknown>|null;queries:QueryExecutionSummary[];
  renderStatus:'NOT_STARTED'|'SUCCESS'|'FAILED';elapsedMs:number;error?:TemplateTestError|null
}
export interface TemplateTestRunSummary {
  id:string;templateId:string;templateVersion?:number|null;draftRevision?:number|null;dataMode:TemplateDataMode;
  testType:'QUERY'|'PREVIEW'|'SIMULATED_PRINT'|'PLUGIN_PRINT';status:'RUNNING'|'SUCCESS'|'FAILED';
  renderStatus:'NOT_STARTED'|'SUCCESS'|'FAILED';printChannel:'NONE'|'SIMULATED'|'BROWSER_EXTENSION_AGENT';
  printStatus:'NOT_REQUESTED'|'PENDING'|'SUCCESS'|'FAILED';printerId?:string|null;pageCount?:number|null;
  agentJobId?:string|null;errorCode?:string|null;message?:string|null;payloadPersisted:boolean;
  startedAt:string;finishedAt?:string|null;elapsedMs?:number|null
}
export interface TemplateTestRunDetail extends TemplateTestRunSummary {
  inputParams?:Record<string,unknown>|null;inputData?:Record<string,unknown>|null;renderData?:Record<string,unknown>|null;
  queries:QueryExecutionSummary[]
}
export interface AgentHealth {
  status:'UP'|string;agent:string;adapter:string;osPrintEnabled:boolean;productionReady:boolean;
  printers:number;startedAt:string;now:string;executionSemantics?:string;spoolerMonitoring?:boolean
}
export interface SpoolerJob {
  id:string
  printerId:string
  documentName:string
  status:string
  submittedAt?:string|null
  size?:number|null
  pagesPrinted?:number|null
  totalPages?:number|null
}
export interface LocalPrinter {
  id:string;name:string;type:string;status:string;isDefault?:boolean;
  agentStatus?:string;adapter?:string;productionReady?:boolean
}
export interface AgentPrintJob {
  accepted:boolean;jobId:string;mode:'TEST'|'PRODUCTION';taskId:string;testRunId?:string|null;printerId:string;
  copies?:number;status:string;adapter:string;executed:boolean;note?:string;createdAt?:string;
  spoolerJobId?:number;spoolerDocumentName?:string;spoolerStatus?:string;spoolerBoundAt?:string;
  documentKind?:'HTML'|'PDF'|'RAW';rawLanguage?:'ESC_POS'|'ZPL'|'TSPL'|'CPCL';byteLength?:number
}


export interface PrinterProfile {
  printerId:string
  displayName:string
  location?:string|null
  enabled:boolean
  defaultPrinter:boolean
  notes?:string|null
  offsetXmm:number
  offsetYmm:number
  scalePercent:number
  duplexMode:'SIMPLEX'|'LONG_EDGE'|'SHORT_EDGE'
  colorMode:'AUTO'|'COLOR'|'MONOCHROME'
  fitMode:'ACTUAL'|'FIT'
  paperSource?:string|null
  createdAt:string
  updatedAt:string
}

export interface AuthSession {
  authenticationEnabled:boolean
  role:'VIEWER'|'DESIGNER'|'OPERATOR'|'ADMIN'|'UNKNOWN'
}

export interface RuntimeCapabilities {
  authenticationEnabled:boolean
  rbacEnabled:boolean
  productionActionsProtected:boolean
  warnings:string[]
}


export type CloudTemplateAccessModel='FREE'|'SUBSCRIPTION'
export type CloudEntitlementState='ACTIVE'|'GRACE'|'EXPIRED'|'REVOKED'|'MISSING'
export type TemplateOrigin='LOCAL'|'CLOUD_FREE'|'CLOUD_SUBSCRIPTION'
export type TemplateLicenseState='ACTIVE'|'GRACE'|'EXPIRED'|'REVOKED'

export interface CloudTemplateCatalogStatus {
  provider:string
  enabled:boolean
  configured:boolean
  available:boolean
  publisherEnabled:boolean
  accountConfigured:boolean
  message:string
}
export type CloudTemplateCategory='FINANCE'|'SALES'|'PURCHASE'|'WAREHOUSE'|'RETAIL'|'MEDICAL'|'LOGISTICS'|'OTHER'
export interface CloudTemplateSummary {
  code:string
  name:string
  documentType:DocumentType
  versionNo:number
  changeNote?:string|null
  publishedAt:string
  uploadedAt:string
  sourceInstance?:string|null
  accessModel:CloudTemplateAccessModel
  productCode?:string|null
  planCode?:string|null
  cloneAllowed:boolean
  entitled:boolean
  entitlementState:CloudEntitlementState
  category:CloudTemplateCategory
  description:string
  tags:string[]
  thumbnailStyle:string
  featured:boolean
  sortOrder:number
  paperLabel:string
}
export interface CloudTemplateBundle extends CloudTemplateSummary {
  design:TemplateDesign
  sampleData:Record<string,unknown>
  dataConfig:TemplateDataConfig
}
export interface TemplateInstallation {
  id:string
  localTemplateId:string
  cloudTemplateCode:string
  cloudVersion:number
  origin:'CLOUD_FREE'|'CLOUD_SUBSCRIPTION'
  accountId?:string|null
  entitlementId?:string|null
  licenseState:TemplateLicenseState
  cloneAllowed:boolean
  lastVerifiedAt?:string|null
  entitlementValidUntil?:string|null
  graceUntil?:string|null
  installedAt:string
  updatedAt:string
}
export interface TemplateInstallationResponse {
  template:PrintTemplate
  installation:TemplateInstallation
}


export type SystemLogLevel='DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'
export interface SystemLogEntry {
  id:number
  level:SystemLogLevel
  module:string
  eventType:string
  message:string
  stackTrace?:string|null
  requestId?:string|null
  taskId?:string|null
  attemptId?:number|null
  agentId?:string|null
  agentInstanceId?:string|null
  printerId?:string|null
  spoolerJobId?:number|null
  hostName?:string|null
  ipAddress?:string|null
  resolved:boolean
  resolvedAt?:string|null
  createdAt:string
  updatedAt:string
}
export interface SystemLogPage {
  total:number
  page:number
  size:number
  items:SystemLogEntry[]
}
export interface SystemLogQuery {
  level?:SystemLogLevel
  module?:string
  eventType?:string
  taskId?:string
  attemptId?:number
  agentId?:string
  printerId?:string
  spoolerJobId?:number
  resolved?:boolean
  keyword?:string
  from?:string
  to?:string
  page?:number
  size?:number
}
export interface SystemLogCleanupResult {
  deleted:number
  batches:number
  durationMs:number
  oldestRemainingAt?:string|null
  completedAt:string
}


export interface AgentInstanceRecord {
  agentId:string
  instanceId:string
  hostName:string
  ipAddress?:string|null
  osName:string
  agentVersion:string
  status:'ONLINE'|'UNKNOWN'|'OFFLINE'
  cpuUsage?:number|null
  memoryUsage?:number|null
  activeJobs:number
  queuedJobs:number
  printerCount:number
  spoolerStatus?:string|null
  registeredAt:string
  lastHeartbeatAt:string
  updatedAt:string
}
export interface AgentPrinterRecord {
  agentId:string
  instanceId:string
  printerId:string
  name:string
  type:string
  status:string
  defaultPrinter:boolean
  driverName?:string|null
  portName?:string|null
  shared:boolean
  shareName?:string|null
  location?:string|null
  comment?:string|null
  paperSizes:string[]
  firstSeenAt:string
  lastSeenAt:string
}
export interface AgentHeartbeatRecord {
  id:number
  agentId:string
  instanceId:string
  cpuUsage?:number|null
  memoryUsage?:number|null
  activeJobs:number
  queuedJobs:number
  printerCount:number
  spoolerStatus?:string|null
  agentVersion?:string|null
  createdAt:string
}
export interface AlertRule {
  code:string
  name:string
  severity:string
  enabled:boolean
  windowSeconds:number
  threshold:number
  description?:string|null
  createdAt:string
  updatedAt:string
}
export type AlertStatus='OPEN'|'ACKED'|'RESOLVED'
export interface AlertEvent {
  id:number
  ruleCode:string
  severity:string
  status:AlertStatus
  resourceType:string
  resourceId:string
  message:string
  taskId?:string|null
  attemptId?:number|null
  agentId?:string|null
  printerId?:string|null
  spoolerJobId?:number|null
  firstSeenAt:string
  lastSeenAt:string
  ackedAt?:string|null
  resolvedAt?:string|null
  createdAt:string
  updatedAt:string
}
export interface AlertPage {
  total:number
  page:number
  size:number
  items:AlertEvent[]
}
export interface AlertQuery {
  status?:AlertStatus
  severity?:string
  ruleCode?:string
  resourceType?:string
  agentId?:string
  printerId?:string
  keyword?:string
  page?:number
  size?:number
}
