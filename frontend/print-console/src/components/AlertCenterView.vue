<script setup lang="ts">
import { computed,onMounted,reactive,ref } from 'vue'
import { message } from 'ant-design-vue'
import { acknowledgeAlert,listAlertRules,listAlerts,resolveAlert,setAlertRuleEnabled } from '../api'
import type { AlertEvent,AlertRule,AlertStatus } from '../types'

const props=defineProps<{canOperate:boolean;canAdmin:boolean}>()
const rows=ref<AlertEvent[]>([])
const rules=ref<AlertRule[]>([])
const loading=ref(false)
const rulesLoading=ref(false)
const total=ref(0)
const page=ref(0)
const size=ref(50)
const detail=ref<AlertEvent|null>(null)
const detailOpen=ref(false)
const metrics=reactive({open:0,acked:0,resolved:0})
const filters=reactive({status:'OPEN' as ''|AlertStatus,severity:'',ruleCode:'',resourceType:'',keyword:''})

const activeCount=computed(()=>metrics.open+metrics.acked)
function severityColor(v:string){return v==='CRITICAL'?'magenta':v==='ERROR'?'red':v==='WARNING'||v==='WARN'?'orange':'blue'}
function statusColor(v:string){return v==='OPEN'?'red':v==='ACKED'?'orange':'green'}
function fmt(v?:string|null){if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():v}

async function load(){
  loading.value=true
  try{
    const result=await listAlerts({
      status:filters.status||undefined,severity:filters.severity||undefined,ruleCode:filters.ruleCode||undefined,
      resourceType:filters.resourceType||undefined,keyword:filters.keyword||undefined,page:page.value,size:size.value
    })
    rows.value=result.items;total.value=result.total
  }catch(e:any){message.error(e?.response?.data?.detail||'告警读取失败')}
  finally{loading.value=false}
}
async function loadRules(){rulesLoading.value=true;try{rules.value=await listAlertRules()}finally{rulesLoading.value=false}}
async function loadMetrics(){
  try{
    const [o,a,r]=await Promise.all([
      listAlerts({status:'OPEN',page:0,size:1}),listAlerts({status:'ACKED',page:0,size:1}),listAlerts({status:'RESOLVED',page:0,size:1})
    ])
    metrics.open=o.total;metrics.acked=a.total;metrics.resolved=r.total
  }catch{}
}
async function refresh(){await Promise.all([load(),loadRules(),loadMetrics()])}
function apply(){page.value=0;load()}
function openDetail(row:AlertEvent){detail.value=row;detailOpen.value=true}
async function ack(row:AlertEvent){
  if(!props.canOperate)return
  try{
    const updated=await acknowledgeAlert(row.id);replace(updated);message.success('告警已确认');await loadMetrics()
  }catch(e:any){message.error(e?.response?.data?.detail||'确认告警失败')}
}
async function resolve(row:AlertEvent){
  if(!props.canAdmin)return
  try{
    const updated=await resolveAlert(row.id);replace(updated);message.success('告警已关闭');await loadMetrics()
  }catch(e:any){message.error(e?.response?.data?.detail||'关闭告警失败')}
}
function replace(updated:AlertEvent){
  const i=rows.value.findIndex(x=>x.id===updated.id);if(i>=0)rows.value.splice(i,1,updated)
  if(detail.value?.id===updated.id)detail.value=updated
}
async function toggleRule(rule:AlertRule,enabled:boolean){
  if(!props.canAdmin)return
  try{Object.assign(rule,await setAlertRuleEnabled(rule.code,enabled));message.success((enabled?'已启用 ':'已停用 ')+rule.name)}
  catch(e:any){message.error(e?.response?.data?.detail||'告警规则更新失败')}
}
function changePage(next:number,nextSize:number){page.value=next-1;if(nextSize!==size.value){size.value=nextSize;page.value=0}load()}
onMounted(refresh)
</script>

<template>
<div class="alert-view">
  <div class="page-head">
    <div><span class="eyebrow">ALERT CENTER · OPERATIONS</span><h1>告警中心</h1><p>Agent 离线、Spooler 卡住和打印机连续失败会形成去重告警，并在条件恢复后自动关闭。</p></div>
    <a-button :loading="loading||rulesLoading" @click="refresh">刷新</a-button>
  </div>

  <div class="alert-metrics">
    <a-card :class="{danger:metrics.open>0}"><span>OPEN</span><strong>{{metrics.open}}</strong><em>尚未确认</em></a-card>
    <a-card :class="{attention:metrics.acked>0}"><span>ACKED</span><strong>{{metrics.acked}}</strong><em>已确认，仍在持续</em></a-card>
    <a-card><span>活跃告警</span><strong>{{activeCount}}</strong><em>OPEN + ACKED</em></a-card>
    <a-card><span>已恢复</span><strong>{{metrics.resolved}}</strong><em>自动或人工关闭</em></a-card>
  </div>

  <a-card class="rule-card" title="告警规则">
    <a-table :data-source="rules" :loading="rulesLoading" row-key="code" size="small" :pagination="false">
      <a-table-column title="规则"><template #default="{record}"><strong>{{record.name}}</strong><div class="sub mono">{{record.code}}</div></template></a-table-column>
      <a-table-column title="级别" :width="100"><template #default="{record}"><a-tag :color="severityColor(record.severity)">{{record.severity}}</a-tag></template></a-table-column>
      <a-table-column title="窗口" :width="110"><template #default="{record}">{{record.windowSeconds}} 秒</template></a-table-column>
      <a-table-column title="阈值" data-index="threshold" :width="90"/>
      <a-table-column title="说明" data-index="description"/>
      <a-table-column title="启用" :width="100"><template #default="{record}"><a-switch :checked="record.enabled" :disabled="!canAdmin" @change="(v:boolean)=>toggleRule(record,v)"/></template></a-table-column>
    </a-table>
  </a-card>

  <a-card class="alert-card">
    <div class="filters">
      <a-select v-model:value="filters.status" allow-clear placeholder="状态">
        <a-select-option value="OPEN">OPEN</a-select-option><a-select-option value="ACKED">ACKED</a-select-option><a-select-option value="RESOLVED">RESOLVED</a-select-option>
      </a-select>
      <a-select v-model:value="filters.severity" allow-clear placeholder="级别">
        <a-select-option value="ERROR">ERROR</a-select-option><a-select-option value="WARNING">WARNING</a-select-option><a-select-option value="CRITICAL">CRITICAL</a-select-option>
      </a-select>
      <a-select v-model:value="filters.ruleCode" allow-clear placeholder="规则">
        <a-select-option v-for="rule in rules" :key="rule.code" :value="rule.code">{{rule.name}}</a-select-option>
      </a-select>
      <a-select v-model:value="filters.resourceType" allow-clear placeholder="资源">
        <a-select-option value="AGENT">Agent</a-select-option><a-select-option value="PRINTER">Printer</a-select-option><a-select-option value="SPOOLER">Spooler</a-select-option>
      </a-select>
      <a-input v-model:value="filters.keyword" allow-clear placeholder="消息 / 资源 / Task" @pressEnter="apply"/>
      <a-button type="primary" @click="apply">筛选</a-button>
    </div>

    <a-table :data-source="rows" :loading="loading" row-key="id" :pagination="false" :scroll="{x:1200}">
      <a-table-column title="状态" :width="100"><template #default="{record}"><a-tag :color="statusColor(record.status)">{{record.status}}</a-tag></template></a-table-column>
      <a-table-column title="级别" :width="100"><template #default="{record}"><a-tag :color="severityColor(record.severity)">{{record.severity}}</a-tag></template></a-table-column>
      <a-table-column title="规则" :width="190"><template #default="{record}"><strong>{{record.ruleCode}}</strong><div class="sub">{{record.resourceType}} · {{record.resourceId}}</div></template></a-table-column>
      <a-table-column title="消息" data-index="message" :width="330"/>
      <a-table-column title="关联" :width="280"><template #default="{record}">
        <a-tag v-if="record.taskId">Task {{record.taskId}}</a-tag><a-tag v-if="record.attemptId">Attempt #{{record.attemptId}}</a-tag>
        <a-tag v-if="record.agentId" color="cyan">Agent {{record.agentId}}</a-tag><a-tag v-if="record.printerId" color="blue">Printer {{record.printerId}}</a-tag>
        <a-tag v-if="record.spoolerJobId" color="purple">Job #{{record.spoolerJobId}}</a-tag>
      </template></a-table-column>
      <a-table-column title="最近出现" :width="180"><template #default="{record}">{{fmt(record.lastSeenAt)}}</template></a-table-column>
      <a-table-column title="操作" fixed="right" :width="190"><template #default="{record}">
        <a-space>
          <a-button size="small" @click="openDetail(record)">详情</a-button>
          <a-button v-if="record.status==='OPEN'" size="small" :disabled="!canOperate" @click="ack(record)">ACK</a-button>
          <a-button v-if="record.status!=='RESOLVED'" size="small" danger :disabled="!canAdmin" @click="resolve(record)">关闭</a-button>
        </a-space>
      </template></a-table-column>
    </a-table>
    <div class="pagination-row"><span>共 {{total}} 条</span><a-pagination :current="page+1" :page-size="size" :total="total" show-size-changer @change="changePage" @show-size-change="changePage"/></div>
  </a-card>

  <a-drawer v-model:open="detailOpen" title="告警详情" width="720">
    <template v-if="detail">
      <div class="detail-head"><a-space><a-tag :color="statusColor(detail.status)">{{detail.status}}</a-tag><a-tag :color="severityColor(detail.severity)">{{detail.severity}}</a-tag><strong>{{detail.ruleCode}}</strong></a-space></div>
      <a-alert type="error" show-icon :message="detail.message" style="margin:14px 0"/>
      <a-descriptions bordered size="small" :column="2">
        <a-descriptions-item label="资源">{{detail.resourceType}} / {{detail.resourceId}}</a-descriptions-item><a-descriptions-item label="首次出现">{{fmt(detail.firstSeenAt)}}</a-descriptions-item>
        <a-descriptions-item label="最近出现">{{fmt(detail.lastSeenAt)}}</a-descriptions-item><a-descriptions-item label="ACK">{{fmt(detail.ackedAt)}}</a-descriptions-item>
        <a-descriptions-item label="Task">{{detail.taskId||'—'}}</a-descriptions-item><a-descriptions-item label="Attempt">{{detail.attemptId??'—'}}</a-descriptions-item>
        <a-descriptions-item label="Agent">{{detail.agentId||'—'}}</a-descriptions-item><a-descriptions-item label="Printer">{{detail.printerId||'—'}}</a-descriptions-item>
        <a-descriptions-item label="Windows Job">{{detail.spoolerJobId??'—'}}</a-descriptions-item><a-descriptions-item label="恢复时间">{{fmt(detail.resolvedAt)}}</a-descriptions-item>
      </a-descriptions>
    </template>
  </a-drawer>
</div>
</template>

<style scoped>
.alert-view{min-width:0}.alert-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.alert-metrics .ant-card,.rule-card,.alert-card{border-radius:16px}.alert-metrics span{display:block;color:#7c94aa}.alert-metrics strong{display:block;margin-top:7px;font-size:28px}.alert-metrics em{display:block;margin-top:4px;color:#4f8dbf;font-size:12px;font-style:normal}.danger{border-color:#ffccc7;background:#fffafa}.attention{border-color:#ffd591}.rule-card{margin-bottom:18px}.filters{display:grid;grid-template-columns:150px 150px 210px 150px minmax(240px,1fr) auto;gap:8px;margin-bottom:14px}.sub{margin-top:3px;color:#8196aa;font-size:11px}.mono{font-family:Consolas,"SFMono-Regular",monospace}.pagination-row{display:flex;justify-content:space-between;align-items:center;margin-top:14px;color:#8196aa}@media(max-width:1000px){.alert-metrics{grid-template-columns:repeat(2,1fr)}.filters{grid-template-columns:repeat(2,1fr)}}
</style>
