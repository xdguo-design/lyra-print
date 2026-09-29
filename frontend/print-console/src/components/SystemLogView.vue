<script setup lang="ts">
import { computed,onMounted,reactive,ref } from 'vue'
import { Modal,message } from 'ant-design-vue'
import { cleanupSystemLogs,getSystemLog,listSystemLogs,resolveSystemLog } from '../api'
import type { SystemLogEntry,SystemLogLevel,SystemLogQuery } from '../types'
import { localDateTimeToIso,systemLogLevelColor,systemLogLevelText,systemLogRelation,systemLogTime } from '../system-log/system-log-ui'

const props=defineProps<{canAdmin:boolean}>()

const rows=ref<SystemLogEntry[]>([])
const loading=ref(false)
const total=ref(0)
const page=ref(0)
const size=ref(50)
const detailOpen=ref(false)
const detailLoading=ref(false)
const detail=ref<SystemLogEntry|null>(null)
const resolving=ref(false)
const metricsLoading=ref(false)
const metrics=reactive({all:0,unresolved:0,last24hErrors:0})

const filters=reactive({
  level:'' as ''|SystemLogLevel,
  module:'',
  eventType:'',
  taskId:'',
  attemptId:'',
  agentId:'',
  printerId:'',
  spoolerJobId:'',
  resolved:'' as ''|'true'|'false',
  keyword:'',
  from:'',
  to:''
})

const currentFilterLabel=computed(()=>{
  const parts:string[]=[]
  if(filters.level)parts.push(systemLogLevelText[filters.level])
  if(filters.module)parts.push(filters.module)
  if(filters.eventType)parts.push(filters.eventType)
  if(filters.taskId)parts.push('Task '+filters.taskId)
  if(filters.agentId)parts.push('Agent '+filters.agentId)
  if(filters.printerId)parts.push('Printer '+filters.printerId)
  if(filters.spoolerJobId)parts.push('Job #'+filters.spoolerJobId)
  if(filters.resolved==='true')parts.push('已处理')
  if(filters.resolved==='false')parts.push('未处理')
  return parts.join(' · ')||'全部日志'
})

function query():SystemLogQuery{
  const q:SystemLogQuery={page:page.value,size:size.value}
  if(filters.level)q.level=filters.level
  if(filters.module.trim())q.module=filters.module.trim()
  if(filters.eventType.trim())q.eventType=filters.eventType.trim()
  if(filters.taskId.trim())q.taskId=filters.taskId.trim()
  if(filters.attemptId.trim()&&Number.isFinite(Number(filters.attemptId)))q.attemptId=Number(filters.attemptId)
  if(filters.agentId.trim())q.agentId=filters.agentId.trim()
  if(filters.printerId.trim())q.printerId=filters.printerId.trim()
  if(filters.spoolerJobId.trim()&&Number.isFinite(Number(filters.spoolerJobId)))q.spoolerJobId=Number(filters.spoolerJobId)
  if(filters.resolved)q.resolved=filters.resolved==='true'
  if(filters.keyword.trim())q.keyword=filters.keyword.trim()
  const from=localDateTimeToIso(filters.from)
  const to=localDateTimeToIso(filters.to)
  if(from)q.from=from
  if(to)q.to=to
  return q
}

async function load(){
  loading.value=true
  try{
    const result=await listSystemLogs(query())
    rows.value=result.items
    total.value=result.total
  }catch(e:any){
    message.error(e?.response?.data?.detail||'系统日志读取失败')
  }finally{loading.value=false}
}

async function loadMetrics(){
  metricsLoading.value=true
  try{
    const last24h=new Date(Date.now()-24*60*60*1000).toISOString()
    const [all,errorOpen,fatalOpen,error24,fatal24]=await Promise.all([
      listSystemLogs({page:0,size:1}),
      listSystemLogs({level:'ERROR',resolved:false,page:0,size:1}),
      listSystemLogs({level:'FATAL',resolved:false,page:0,size:1}),
      listSystemLogs({level:'ERROR',from:last24h,page:0,size:1}),
      listSystemLogs({level:'FATAL',from:last24h,page:0,size:1})
    ])
    metrics.all=all.total
    metrics.unresolved=errorOpen.total+fatalOpen.total
    metrics.last24hErrors=error24.total+fatal24.total
  }catch{
    // metrics are supplemental; the main table still reports its own failure.
  }finally{metricsLoading.value=false}
}

async function refresh(){
  await Promise.all([load(),loadMetrics()])
}

function applyFilters(){
  page.value=0
  load()
}

function resetFilters(){
  Object.assign(filters,{
    level:'',module:'',eventType:'',taskId:'',attemptId:'',agentId:'',printerId:'',
    spoolerJobId:'',resolved:'',keyword:'',from:'',to:''
  })
  page.value=0
  load()
}

function showUnresolvedErrors(){
  Object.assign(filters,{level:'ERROR',resolved:'false'})
  page.value=0
  load()
}

function showFatal(){
  Object.assign(filters,{level:'FATAL',resolved:''})
  page.value=0
  load()
}

async function openDetail(row:SystemLogEntry){
  detailOpen.value=true
  detailLoading.value=true
  try{detail.value=await getSystemLog(row.id)}
  catch(e:any){message.error(e?.response?.data?.detail||'日志详情读取失败')}
  finally{detailLoading.value=false}
}

async function markResolved(){
  if(!detail.value||!props.canAdmin)return
  resolving.value=true
  try{
    detail.value=await resolveSystemLog(detail.value.id)
    const i=rows.value.findIndex(x=>x.id===detail.value?.id)
    if(i>=0)rows.value.splice(i,1,detail.value)
    message.success('错误日志已标记为已处理')
    await loadMetrics()
  }catch(e:any){message.error(e?.response?.data?.detail||'标记处理失败')}
  finally{resolving.value=false}
}

function runCleanup(){
  if(!props.canAdmin)return
  Modal.confirm({
    title:'立即执行系统日志清理？',
    content:'将按服务端保留策略分批清理过期日志。未处理 ERROR/FATAL 和活跃 PrintTask 关联日志不会被删除。',
    okText:'执行清理',
    cancelText:'取消',
    async onOk(){
      try{
        const result=await cleanupSystemLogs()
        message.success('日志清理完成：删除 '+result.deleted+' 条，'+result.batches+' 批，耗时 '+result.durationMs+' ms')
        page.value=0
        await refresh()
      }catch(e:any){message.error(e?.response?.data?.detail||'系统日志清理失败');throw e}
    }
  })
}

function onPageChange(next:number,nextSize:number){
  page.value=next-1
  if(size.value!==nextSize){size.value=nextSize;page.value=0}
  load()
}

function levelColor(value:unknown){
  return systemLogLevelColor[(value as SystemLogLevel)]||'default'
}

function statusLabel(row:SystemLogEntry){
  if(!['ERROR','FATAL'].includes(row.level))return '—'
  return row.resolved?'已处理':'待处理'
}

onMounted(refresh)
</script>

<template>
  <div class="system-log-view">
    <div class="page-head">
      <div>
        <span class="eyebrow">OBSERVABILITY · SYSTEM LOG</span>
        <h1>系统日志</h1>
        <p>统一查看 PrintTask、Attempt、Agent、Printer 与 Windows Spooler 的运行日志和错误链路。</p>
      </div>
      <a-space>
        <a-button @click="showUnresolvedErrors">只看待处理错误</a-button>
        <a-button @click="showFatal">FATAL</a-button>
        <a-button :loading="loading||metricsLoading" @click="refresh">刷新</a-button>
        <a-tooltip :title="canAdmin?'按服务端保留策略执行分批清理':'仅管理员可执行日志清理'">
          <a-button danger :disabled="!canAdmin" @click="runCleanup">立即清理</a-button>
        </a-tooltip>
      </a-space>
    </div>

    <div class="log-metrics">
      <a-card :loading="metricsLoading">
        <span>全部日志</span><strong>{{metrics.all}}</strong><em>当前持久化日志</em>
      </a-card>
      <a-card :loading="metricsLoading" :class="{attention:metrics.unresolved>0}">
        <span>待处理错误</span><strong>{{metrics.unresolved}}</strong><em>ERROR + FATAL</em>
      </a-card>
      <a-card :loading="metricsLoading" :class="{attention:metrics.last24hErrors>0}">
        <span>24 小时错误</span><strong>{{metrics.last24hErrors}}</strong><em>最近 24 小时 ERROR/FATAL</em>
      </a-card>
      <a-card>
        <span>当前筛选</span><strong>{{total}}</strong><em :title="currentFilterLabel">{{currentFilterLabel}}</em>
      </a-card>
    </div>

    <a-card class="log-card">
      <div class="filters">
        <a-input v-model:value="filters.keyword" allow-clear placeholder="错误内容 / 模块 / 事件 / 堆栈" @pressEnter="applyFilters"/>
        <a-select v-model:value="filters.level" allow-clear placeholder="全部级别">
          <a-select-option value="DEBUG">DEBUG · 调试</a-select-option>
          <a-select-option value="INFO">INFO · 信息</a-select-option>
          <a-select-option value="WARN">WARN · 警告</a-select-option>
          <a-select-option value="ERROR">ERROR · 错误</a-select-option>
          <a-select-option value="FATAL">FATAL · 严重</a-select-option>
        </a-select>
        <a-select v-model:value="filters.resolved" allow-clear placeholder="处理状态">
          <a-select-option value="false">待处理</a-select-option>
          <a-select-option value="true">已处理</a-select-option>
        </a-select>
        <a-input v-model:value="filters.module" allow-clear placeholder="模块，如 SPOOLER"/>
        <a-input v-model:value="filters.eventType" allow-clear placeholder="事件，如 TASK_FAILED"/>
        <a-input v-model:value="filters.taskId" allow-clear placeholder="PrintTask ID"/>
        <a-input v-model:value="filters.attemptId" allow-clear placeholder="Attempt ID"/>
        <a-input v-model:value="filters.agentId" allow-clear placeholder="Agent ID"/>
        <a-input v-model:value="filters.printerId" allow-clear placeholder="Printer ID"/>
        <a-input v-model:value="filters.spoolerJobId" allow-clear placeholder="Windows Job ID"/>
        <a-input v-model:value="filters.from" type="datetime-local" title="开始时间"/>
        <a-input v-model:value="filters.to" type="datetime-local" title="结束时间"/>
        <a-button type="primary" @click="applyFilters">筛选</a-button>
        <a-button @click="resetFilters">清空</a-button>
      </div>

      <a-alert
        v-if="!canAdmin"
        type="info"
        show-icon
        message="当前账号为只读日志权限"
        description="可以查询和查看完整错误链路；标记已处理与手工清理需要 ADMIN 权限。"
        style="margin-bottom:12px"
      />

      <a-table :data-source="rows" :loading="loading" row-key="id" :pagination="false" :scroll="{x:1280}">
        <a-table-column title="时间" :width="172">
          <template #default="{record}">{{systemLogTime(record.createdAt)}}</template>
        </a-table-column>
        <a-table-column title="级别" :width="92">
          <template #default="{record}">
            <a-tag :color="levelColor(record.level)">{{record.level}}</a-tag>
          </template>
        </a-table-column>
        <a-table-column title="模块 / 事件" :width="230">
          <template #default="{record}">
            <strong>{{record.module}}</strong>
            <div class="mono sub">{{record.eventType}}</div>
          </template>
        </a-table-column>
        <a-table-column title="消息" :width="330">
          <template #default="{record}">
            <div class="message-cell" :title="record.message">{{record.message}}</div>
          </template>
        </a-table-column>
        <a-table-column title="关联对象" :width="315">
          <template #default="{record}">
            <div class="relation" :title="systemLogRelation(record)">
              <a-tag v-if="record.taskId">Task {{record.taskId}}</a-tag>
              <a-tag v-if="record.attemptId!=null">Attempt #{{record.attemptId}}</a-tag>
              <a-tag v-if="record.agentId" color="cyan">Agent {{record.agentId}}</a-tag>
              <a-tag v-if="record.printerId" color="blue">Printer {{record.printerId}}</a-tag>
              <a-tag v-if="record.spoolerJobId!=null" color="purple">Job #{{record.spoolerJobId}}</a-tag>
              <span v-if="!record.taskId&&record.attemptId==null&&!record.agentId&&!record.printerId&&record.spoolerJobId==null">—</span>
            </div>
          </template>
        </a-table-column>
        <a-table-column title="处理" :width="90">
          <template #default="{record}">
            <a-tag v-if="['ERROR','FATAL'].includes(record.level)" :color="record.resolved?'green':'red'">{{statusLabel(record)}}</a-tag>
            <span v-else>—</span>
          </template>
        </a-table-column>
        <a-table-column title="操作" fixed="right" :width="92">
          <template #default="{record}"><a-button size="small" @click="openDetail(record)">详情</a-button></template>
        </a-table-column>
      </a-table>

      <div class="pagination-row">
        <span>共 {{total}} 条</span>
        <a-pagination
          :current="page+1"
          :page-size="size"
          :total="total"
          :show-size-changer="true"
          :page-size-options="['20','50','100','200']"
          @change="onPageChange"
          @show-size-change="onPageChange"
        />
      </div>
    </a-card>

    <a-drawer v-model:open="detailOpen" title="系统日志详情" width="760">
      <a-spin :spinning="detailLoading">
        <template v-if="detail">
          <div class="detail-head">
            <div>
              <a-tag :color="levelColor(detail.level)">{{detail.level}} · {{systemLogLevelText[detail.level]}}</a-tag>
              <strong>{{detail.module}} / {{detail.eventType}}</strong>
            </div>
            <a-button
              v-if="['ERROR','FATAL'].includes(detail.level)&&!detail.resolved"
              type="primary"
              :disabled="!canAdmin"
              :loading="resolving"
              @click="markResolved"
            >标记已处理</a-button>
          </div>

          <a-alert
            :type="detail.level==='WARN'?'warning':detail.level==='ERROR'||detail.level==='FATAL'?'error':'info'"
            show-icon
            :message="detail.message"
            :description="detail.resolved?'已处理'+(detail.resolvedAt?' · '+systemLogTime(detail.resolvedAt):''):'尚未标记处理'"
            style="margin:14px 0"
          />

          <a-descriptions bordered size="small" :column="2">
            <a-descriptions-item label="日志 ID">#{{detail.id}}</a-descriptions-item>
            <a-descriptions-item label="时间">{{systemLogTime(detail.createdAt)}}</a-descriptions-item>
            <a-descriptions-item label="模块">{{detail.module}}</a-descriptions-item>
            <a-descriptions-item label="事件">{{detail.eventType}}</a-descriptions-item>
            <a-descriptions-item label="Request ID">{{detail.requestId||'—'}}</a-descriptions-item>
            <a-descriptions-item label="主机">{{detail.hostName||'—'}}</a-descriptions-item>
            <a-descriptions-item label="IP">{{detail.ipAddress||'—'}}</a-descriptions-item>
            <a-descriptions-item label="Agent">{{detail.agentId||'—'}}</a-descriptions-item>
            <a-descriptions-item label="Agent Instance">{{detail.agentInstanceId||'—'}}</a-descriptions-item>
            <a-descriptions-item label="Printer">{{detail.printerId||'—'}}</a-descriptions-item>
            <a-descriptions-item label="PrintTask">{{detail.taskId||'—'}}</a-descriptions-item>
            <a-descriptions-item label="Attempt">{{detail.attemptId==null?'—':'#'+detail.attemptId}}</a-descriptions-item>
            <a-descriptions-item label="Windows Job">{{detail.spoolerJobId==null?'—':'#'+detail.spoolerJobId}}</a-descriptions-item>
            <a-descriptions-item label="更新时间">{{systemLogTime(detail.updatedAt)}}</a-descriptions-item>
          </a-descriptions>

          <template v-if="detail.stackTrace">
            <a-divider>异常堆栈</a-divider>
            <pre class="stack">{{detail.stackTrace}}</pre>
          </template>

          <a-divider>关联链路</a-divider>
          <div class="relation-panel">
            <span v-if="detail.taskId"><b>PrintTask</b>{{detail.taskId}}</span>
            <span v-if="detail.attemptId!=null"><b>Attempt</b>#{{detail.attemptId}}</span>
            <span v-if="detail.agentId"><b>Agent</b>{{detail.agentId}}</span>
            <span v-if="detail.printerId"><b>Printer</b>{{detail.printerId}}</span>
            <span v-if="detail.spoolerJobId!=null"><b>Windows Job</b>#{{detail.spoolerJobId}}</span>
            <a-empty v-if="!detail.taskId&&detail.attemptId==null&&!detail.agentId&&!detail.printerId&&detail.spoolerJobId==null" description="没有业务关联对象"/>
          </div>
        </template>
      </a-spin>
    </a-drawer>
  </div>
</template>

<style scoped>
.system-log-view{min-width:0}.log-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.log-metrics .ant-card{border-radius:16px}.log-metrics span{display:block;color:#7c94aa}.log-metrics strong{display:block;margin-top:7px;font-size:28px}.log-metrics em{display:block;margin-top:4px;overflow:hidden;color:#4f8dbf;font-size:12px;font-style:normal;text-overflow:ellipsis;white-space:nowrap}
.log-metrics .attention{border-color:#ffd2cc;background:#fffafa}.log-card{border-radius:18px}.filters{display:grid;grid-template-columns:minmax(240px,1.5fr) 130px 120px 150px 190px 190px 120px 160px 160px 145px 190px 190px auto auto;gap:8px;margin-bottom:14px}
.mono{font-family:Consolas,"SFMono-Regular",monospace}.sub{margin-top:3px;color:#7f94a8;font-size:11px}.message-cell{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-height:1.5}.relation{display:flex;flex-wrap:wrap;gap:4px}.pagination-row{display:flex;justify-content:space-between;align-items:center;margin-top:14px;color:#7f94a8}
.detail-head{display:flex;justify-content:space-between;align-items:center;gap:16px}.detail-head>div{display:flex;align-items:center;gap:9px}.stack{max-height:420px;margin:0;padding:14px;overflow:auto;border:1px solid #dbe8f1;border-radius:10px;background:#0f2030;color:#d8ebf8;font:12px/1.65 Consolas,"SFMono-Regular",monospace;white-space:pre-wrap;word-break:break-word}.relation-panel{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.relation-panel span{display:flex;flex-direction:column;padding:10px 12px;border:1px solid #deebf4;border-radius:10px;background:#f8fcff;color:#42627c}.relation-panel b{margin-bottom:3px;color:#8196a8;font-size:11px}
@media(max-width:1450px){.filters{grid-template-columns:repeat(4,minmax(160px,1fr))}.log-metrics{grid-template-columns:repeat(2,1fr)}}@media(max-width:850px){.filters,.log-metrics,.relation-panel{grid-template-columns:1fr}.pagination-row{align-items:flex-start;flex-direction:column;gap:10px}}
</style>
