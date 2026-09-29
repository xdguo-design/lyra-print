<script setup lang="ts">
import { computed,ref } from 'vue'
import { message } from 'ant-design-vue'
import type {
  DataSourceConnection,LocalPrinter,QueryTestResponse,TemplateDataConfig,TemplateQueryConfig,
  TemplateQueryParam,TemplateQueryParamType,TemplateQueryResultType,TemplateTestTarget,TemplateValidationResult
} from '../types'
import type { UiProblem } from '../template-data-ui'
import { parseJsonObject,validateDataConfig } from '../template-data-ui'
import { listLocalPrinters } from '../print/extension-bridge'

const props=defineProps<{
  config:TemplateDataConfig
  connections:DataSourceConnection[]
  busy?:boolean
  dirty?:boolean
  canRetry?:boolean
  queryResult?:QueryTestResponse|null
  serverError?:UiProblem|null
  serverValidation?:TemplateValidationResult|null
  testContext?:{label:string;target?:TemplateTestTarget|null;testRunId?:string|null}|null
  connectionsError?:string|null
}>()
const emit=defineEmits<{
  (e:'snapshot'):void
  (e:'validate'):void
  (e:'test-query',queryId:string,params:Record<string,unknown>):void
  (e:'preview',params:Record<string,unknown>):void
  (e:'simulated',params:Record<string,unknown>):void
  (e:'plugin',params:Record<string,unknown>,printerId:string):void
  (e:'retry'):void
  (e:'dismiss-error'):void
  (e:'reload-connections'):void
}>()

const paramsText=ref('{}')
const printers=ref<LocalPrinter[]>([])
const printerId=ref('')
const loadingPrinters=ref(false)

const issues=computed(()=>validateDataConfig(props.config,props.connections))
const errors=computed(()=>issues.value.filter(v=>v.level==='error'))
const warnings=computed(()=>issues.value.filter(v=>v.level==='warning'))
const paramsParsed=computed(()=>parseJsonObject(paramsText.value))
const paramsError=computed(()=>paramsParsed.value.error||'')
const blocked=computed(()=>props.busy||errors.value.length>0||!!paramsError.value)

function issuesFor(queryId:string){return issues.value.filter(v=>v.queryId===queryId)}
function queryBlocked(queryId:string){return props.busy||issuesFor(queryId).some(v=>v.level==='error')||!!paramsError.value}
function queryResult(queryId:string){return props.queryResult?.query?.queryId===queryId?props.queryResult:null}
function targetLabel(target?:TemplateTestTarget|null){
  if(!target)return ''
  return target.kind==='VERSION'?'发布版本 v'+target.versionNo:'草稿修订 r'+target.draftRevision
}

function changeMode(event:any){
  const mode=event?.target?.value as TemplateDataConfig['mode']
  if(!mode||mode===props.config.mode)return
  emit('snapshot')
  props.config.mode=mode
}
function setEnabled(query:TemplateQueryConfig,value:boolean){
  if(query.enabled===value)return
  emit('snapshot')
  query.enabled=value
}
function setRequired(param:TemplateQueryParam,value:boolean){
  if(param.required===value)return
  emit('snapshot')
  param.required=value
}
function onEnabledChange(query:TemplateQueryConfig,value:boolean|string|number){setEnabled(query,Boolean(value))}
function onRequiredChange(param:TemplateQueryParam,event:{target?:{checked?:boolean}}){setRequired(param,Boolean(event.target?.checked))}
function addQuery(){
  emit('snapshot')
  const next=props.config.queries.length+1
  props.config.queries.push({
    queryId:'query-'+next,name:'查询 '+next,connectionId:props.connections.find(c=>c.enabled&&c.readOnly)?.id||'',
    sql:'SELECT 1 AS value',params:[],resultKey:'result'+next,resultType:'ARRAY',order:next*10,
    enabled:true,timeoutMs:5000,maxRows:1000
  })
}
function removeQuery(index:number){emit('snapshot');props.config.queries.splice(index,1)}
function move(index:number,delta:number){
  const target=index+delta;if(target<0||target>=props.config.queries.length)return
  emit('snapshot')
  const [item]=props.config.queries.splice(index,1);props.config.queries.splice(target,0,item)
  props.config.queries.forEach((q,i)=>q.order=(i+1)*10)
}
function addParam(query:TemplateQueryConfig){
  emit('snapshot')
  query.params.push({name:'param'+(query.params.length+1),type:'STRING',required:false})
}
function removeParam(query:TemplateQueryConfig,index:number){emit('snapshot');query.params.splice(index,1)}
function defaultText(param:TemplateQueryParam){
  return param.defaultValue===undefined?'':typeof param.defaultValue==='string'?param.defaultValue:JSON.stringify(param.defaultValue)
}
function setDefault(param:TemplateQueryParam,value:string){
  if(value===''){delete param.defaultValue;return}
  if(param.type==='INTEGER'){const n=Number(value);param.defaultValue=Number.isInteger(n)?n:value;return}
  if(param.type==='DECIMAL'){param.defaultValue=value;return}
  if(param.type==='BOOLEAN'){param.defaultValue=value==='true';return}
  param.defaultValue=value
}
function parsedParams(){
  const result=parseJsonObject(paramsText.value)
  if(result.error){message.error(result.error);return null}
  return result.value||{}
}
function testQuery(queryId:string){const p=parsedParams();if(p)emit('test-query',queryId,p)}
function preview(){const p=parsedParams();if(p)emit('preview',p)}
function simulated(){const p=parsedParams();if(p)emit('simulated',p)}
function plugin(){
  const p=parsedParams();if(!p)return
  if(!printerId.value){message.warning('请选择本地打印机');return}
  emit('plugin',p,printerId.value)
}
async function refreshPrinters(){
  loadingPrinters.value=true
  try{
    printers.value=await listLocalPrinters()
    if(!printerId.value)printerId.value=printers.value.find(p=>p.status==='ONLINE')?.id||printers.value[0]?.id||''
    message.success('已读取本地打印机')
  }catch(e:any){message.error(e?.message||'未检测到打印扩展 / Agent')}
  finally{loadingPrinters.value=false}
}
</script>

<template>
  <div class="data-panel">
    <div class="panel-title">
      <div>
        <h3>数据配置</h3>
        <small>样例数据负责设计；测试数据只在明确测试成功后进入预览，修改模板后自动失效。</small>
      </div>
      <a-space>
        <a-tag v-if="errors.length" color="red">{{errors.length}} 个错误</a-tag>
        <a-tag v-else color="green">本地检查通过</a-tag>
        <a-button size="small" :loading="busy" @click="emit('validate')">{{dirty?'保存并校验':'后端校验'}}</a-button>
      </a-space>
    </div>

    <div class="mode-row">
      <a-radio-group :value="config.mode" button-style="solid" @change="changeMode">
        <a-radio-button value="JSON">JSON</a-radio-button>
        <a-radio-button value="SQL">SQL</a-radio-button>
      </a-radio-group>
      <span class="mode-help">{{config.mode==='JSON'?'直接使用样例 / inputData':'由后端只读执行多条 SQL，并按 resultKey 合并'}}</span>
    </div>

    <a-alert
      v-if="config.mode==='SQL'&&!connectionsError&&!connections.length"
      type="warning"
      show-icon
      class="status-alert"
      message="尚未配置可用的数据连接"
      description="请先在数据源管理中创建并启用只读连接；SQL 查询测试和预览需要使用 connectionId。"
    />

    <a-alert
      v-if="connectionsError"
      type="warning"
      show-icon
      class="status-alert"
      message="数据连接列表读取失败"
      :description="connectionsError"
    >
      <template #action><a-button size="small" @click="emit('reload-connections')">重新读取</a-button></template>
    </a-alert>

    <a-alert
      v-if="serverError"
      type="error"
      show-icon
      closable
      class="status-alert"
      :message="serverError.code+(serverError.queryId?' · '+serverError.queryId:'')"
      :description="serverError.message"
      @close="emit('dismiss-error')"
    >
      <template #action><a-button v-if="canRetry" size="small" danger @click="emit('retry')">重试上次操作</a-button></template>
    </a-alert>

    <a-alert v-if="testContext" type="success" show-icon class="status-alert">
      <template #message>
        当前预览数据：{{testContext.label}}
        <a-tag v-if="testContext.target" color="blue">{{targetLabel(testContext.target)}}</a-tag>
      </template>
      <template #description>
        <span v-if="testContext.testRunId">TestRun {{testContext.testRunId}}。任何设计、样例或 SQL 配置修改都会使该测试数据失效。</span>
      </template>
    </a-alert>

    <a-alert
      v-if="serverValidation&&!serverValidation.valid"
      type="error"
      show-icon
      class="status-alert"
      message="后端静态校验未通过"
      :description="serverValidation.errors.slice(0,4).join('；')+(serverValidation.errors.length>4?'；…':'')"
    />
    <a-alert
      v-else-if="serverValidation?.warnings.length"
      type="warning"
      show-icon
      class="status-alert"
      message="后端校验通过，但有警告"
      :description="serverValidation.warnings.slice(0,3).join('；')"
    />

    <a-alert
      v-if="dirty"
      type="warning"
      show-icon
      class="status-alert"
      message="当前数据配置尚未保存"
      description="执行后端校验、查询测试或测试预览时会先保存当前草稿；如果模板原本处于 TESTING / REVIEWING / PUBLISHED，保存后会回到 DRAFT。"
    />

    <a-alert
      v-if="config.mode==='JSON'"
      type="info"
      show-icon
      class="status-alert"
      message="JSON 模式不会查询业务库；正式打印会冻结最终 renderData，测试记录不会进入正式打印报表。"
    />

    <template v-if="config.mode==='SQL'">
      <div class="query-toolbar">
        <span>查询按 order 顺序执行；相同 connectionId 复用同一个只读连接。</span>
        <a-button size="small" type="primary" @click="addQuery">新增查询</a-button>
      </div>

      <a-empty v-if="!config.queries.length" description="尚未配置 SQL 查询"/>
      <a-card
        v-for="(query,index) in config.queries"
        :key="query.queryId+'-'+index"
        size="small"
        class="query-card"
        :class="{problem:issuesFor(query.queryId).some(v=>v.level==='error')||serverError?.queryId===query.queryId}"
      >
        <template #title>
          <div class="query-title">
            <a-switch :checked="query.enabled" size="small" @change="onEnabledChange(query,$event)"/>
            <strong>{{query.name||query.queryId||('查询 '+(index+1))}}</strong>
            <a-tag>{{query.resultKey||'未设置 resultKey'}} · {{query.resultType}}</a-tag>
            <a-tag v-if="issuesFor(query.queryId).some(v=>v.level==='error')" color="red">
              {{issuesFor(query.queryId).filter(v=>v.level==='error').length}} 错误
            </a-tag>
          </div>
        </template>
        <template #extra>
          <a-space>
            <a-button size="small" :disabled="index===0" @click="move(index,-1)">↑</a-button>
            <a-button size="small" :disabled="index===config.queries.length-1" @click="move(index,1)">↓</a-button>
            <a-button size="small" :loading="busy" :disabled="queryBlocked(query.queryId)" @click="testQuery(query.queryId)">测试查询</a-button>
            <a-button size="small" danger @click="removeQuery(index)">删除</a-button>
          </a-space>
        </template>

        <div v-if="issuesFor(query.queryId).length" class="query-issues">
          <div v-for="issue in issuesFor(query.queryId).slice(0,5)" :key="issue.code+issue.message" :class="issue.level">
            {{issue.level==='error'?'错误':'提示'}} · {{issue.message}}
          </div>
        </div>

        <div v-if="queryResult(query.queryId)" class="query-result" :class="{failed:queryResult(query.queryId)?.status!=='SUCCESS'}">
          <div>
            <strong>{{queryResult(query.queryId)?.status==='SUCCESS'?'最近测试成功':'最近测试失败'}}</strong>
            <span v-if="queryResult(query.queryId)?.query">
              {{queryResult(query.queryId)?.query?.rowCount??0}} 行 · {{queryResult(query.queryId)?.query?.elapsedMs??0}} ms
            </span>
          </div>
          <pre v-if="queryResult(query.queryId)?.status==='SUCCESS'">{{JSON.stringify(queryResult(query.queryId)?.result,null,2)}}</pre>
          <span v-else>{{queryResult(query.queryId)?.error?.code}} · {{queryResult(query.queryId)?.error?.message}}</span>
        </div>

        <div class="grid two">
          <a-form-item label="queryId" :validate-status="issuesFor(query.queryId).some(v=>v.code.includes('QUERY_ID'))?'error':''">
            <a-input v-model:value="query.queryId" @focus="emit('snapshot')" placeholder="例如 order-header"/>
          </a-form-item>
          <a-form-item label="名称"><a-input v-model:value="query.name" @focus="emit('snapshot')" placeholder="给业务人员看的名称"/></a-form-item>
          <a-form-item label="数据连接" :validate-status="issuesFor(query.queryId).some(v=>v.code.startsWith('CONNECTION'))?'error':''">
            <a-select v-model:value="query.connectionId" @focus="emit('snapshot')" placeholder="请选择只读连接">
              <a-select-option v-for="c in connections" :key="c.id" :value="c.id" :disabled="!c.enabled||!c.readOnly">
                {{c.name}} · {{c.dbType}}{{!c.enabled?' · 已停用':!c.readOnly?' · 非只读':''}}
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="resultKey" :validate-status="issuesFor(query.queryId).some(v=>v.code.startsWith('RESULT_KEY'))?'error':''">
            <a-input v-model:value="query.resultKey" @focus="emit('snapshot')" placeholder="例如 order / items"/>
          </a-form-item>
          <a-form-item label="结果类型">
            <a-select v-model:value="query.resultType" @focus="emit('snapshot')">
              <a-select-option v-for="t in (['OBJECT','ARRAY','SCALAR'] as TemplateQueryResultType[])" :key="t" :value="t">{{t}}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="order"><a-input-number v-model:value="query.order" :min="0" @focus="emit('snapshot')"/></a-form-item>
          <a-form-item label="timeoutMs" :validate-status="issuesFor(query.queryId).some(v=>v.code==='TIMEOUT_RANGE')?'error':''">
            <a-input-number v-model:value="query.timeoutMs" :min="100" :max="30000" @focus="emit('snapshot')"/>
          </a-form-item>
          <a-form-item label="maxRows" :validate-status="issuesFor(query.queryId).some(v=>v.code==='MAX_ROWS_RANGE')?'error':''">
            <a-input-number v-model:value="query.maxRows" :min="1" :max="10000" @focus="emit('snapshot')"/>
          </a-form-item>
        </div>

        <a-form-item label="只读 SQL" :validate-status="issuesFor(query.queryId).some(v=>v.code.startsWith('SQL_'))?'error':''">
          <a-textarea
            v-model:value="query.sql"
            :rows="6"
            class="sql-editor"
            @focus="emit('snapshot')"
            placeholder="SELECT ... WHERE id=:id"
          />
        </a-form-item>

        <div class="param-head"><strong>参数</strong><a-button size="small" @click="addParam(query)">新增参数</a-button></div>
        <div v-if="!query.params.length" class="empty-params">当前查询没有参数。</div>
        <div v-for="(param,pIndex) in query.params" :key="pIndex" class="param-row">
          <a-input v-model:value="param.name" placeholder="name" @focus="emit('snapshot')"/>
          <a-select v-model:value="param.type" @focus="emit('snapshot')">
            <a-select-option v-for="t in (['STRING','INTEGER','DECIMAL','BOOLEAN','DATE','DATETIME'] as TemplateQueryParamType[])" :key="t" :value="t">{{t}}</a-select-option>
          </a-select>
          <a-checkbox :checked="param.required" @change="onRequiredChange(param,$event)">必填</a-checkbox>
          <a-input :value="defaultText(param)" placeholder="defaultValue" @focus="emit('snapshot')" @change="setDefault(param,($event.target as HTMLInputElement).value)"/>
          <a-button size="small" danger @click="removeParam(query,pIndex)">×</a-button>
        </div>
      </a-card>
    </template>

    <div v-if="issues.filter(v=>!v.queryId).length" class="global-issues">
      <div v-for="issue in issues.filter(v=>!v.queryId)" :key="issue.code+issue.message" :class="issue.level">{{issue.message}}</div>
    </div>

    <a-divider/>
    <a-form-item label="测试参数 JSON" :validate-status="paramsError?'error':''" :help="paramsError||'参数只用于测试；不会保存密码，也不会进入正式打印任务。'">
      <a-textarea v-model:value="paramsText" :rows="5" placeholder='{"patientNo":"P001"}'/>
    </a-form-item>

    <div class="test-actions">
      <a-button :loading="busy" :disabled="blocked" @click="preview">准备测试数据 / 预览</a-button>
      <a-button :loading="busy" :disabled="blocked" @click="simulated">模拟打印测试</a-button>
      <a-select v-model:value="printerId" style="min-width:190px" placeholder="本地打印机">
        <a-select-option v-for="p in printers" :key="p.id" :value="p.id" :disabled="p.status!=='ONLINE'">{{p.name}} · {{p.status}}</a-select-option>
      </a-select>
      <a-button :loading="loadingPrinters" @click="refreshPrinters">读取打印机</a-button>
      <a-button type="primary" :loading="busy" :disabled="blocked||!printerId" @click="plugin">插件打印测试</a-button>
    </div>

    <div v-if="warnings.length" class="warning-list">
      <span v-for="item in warnings.slice(0,4)" :key="item.code+item.message">提示 · {{item.message}}</span>
    </div>
  </div>
</template>

<style scoped>
.data-panel{margin-top:10px}.panel-title,.query-toolbar,.query-title,.param-head,.test-actions,.mode-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.panel-title h3{margin:0}.panel-title small,.query-toolbar span,.mode-help{color:#8295a5}.mode-row{margin:12px 0}.status-alert{margin:8px 0}.query-toolbar{margin:12px 0}.query-card{margin:10px 0;transition:border-color .2s,box-shadow .2s}.query-card.problem{border-color:#ffccc7;box-shadow:0 0 0 1px rgba(255,77,79,.05)}.query-title{justify-content:flex-start;flex-wrap:wrap}.grid.two{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}.sql-editor{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.param-head{margin:6px 0}.param-row{display:grid;grid-template-columns:1.2fr 1fr auto 1.2fr auto;gap:6px;align-items:center;margin-bottom:6px}.empty-params{padding:7px 0;color:#91a4b5;font-size:12px}.test-actions{justify-content:flex-start;flex-wrap:wrap}.query-issues,.global-issues,.warning-list{display:grid;gap:4px;margin:0 0 10px}.query-issues>div,.global-issues>div,.warning-list>span{font-size:12px;padding:5px 7px;border-radius:6px}.query-issues .error,.global-issues .error{background:#fff2f0;color:#cf1322}.query-issues .warning,.global-issues .warning,.warning-list>span{background:#fffbe6;color:#ad6800}.query-result{margin:0 0 10px;padding:8px;border-radius:8px;background:#f6ffed;border:1px solid #b7eb8f}.query-result.failed{background:#fff2f0;border-color:#ffccc7}.query-result>div{display:flex;justify-content:space-between;gap:8px}.query-result pre{max-height:150px;overflow:auto;margin:6px 0 0;padding:7px;background:#fff;border-radius:6px;font-size:11px;white-space:pre-wrap}.warning-list{margin-top:10px}
@media(max-width:1380px){.grid.two{grid-template-columns:1fr}.param-row{grid-template-columns:1fr 1fr}.param-row .ant-btn{justify-self:start}}
</style>
