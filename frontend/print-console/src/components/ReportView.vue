<script setup lang="ts">
import { computed,onMounted,reactive,ref } from 'vue'
import { message } from 'ant-design-vue'
import type { ReportDailyRow,ReportLogRow,ReportPrinterRow,ReportSummary,ReportTemplateRow } from '../types'
import { getReportDaily,getReportLogs,getReportPrinters,getReportSummary,getReportTemplates } from '../api'
import { downloadCsv } from '../report/report-csv'

const ranges=[{key:'7d',label:'近 7 天',days:7},{key:'30d',label:'近 30 天',days:30},{key:'all',label:'全部',days:0}]
const rangeKey=ref('7d')
const loading=ref(false)
const summary=ref<ReportSummary|null>(null)
const daily=ref<ReportDailyRow[]>([])
const printers=ref<ReportPrinterRow[]>([])
const templates=ref<ReportTemplateRow[]>([])
const logs=ref<ReportLogRow[]>([])
const logFilter=reactive({status:undefined as string|undefined,keyword:''})
const logStatuses=[{value:undefined,label:'全部结果'},{value:'SUCCESS',label:'成功'},{value:'FAILED',label:'失败'},{value:'PRINTING',label:'打印中'},{value:'WAITING_AGENT',label:'待代理'}]

async function refreshLogs(){
  try{
    const p=rangeParams()
    logs.value=await getReportLogs({...p,status:logFilter.status,keyword:logFilter.keyword||undefined,limit:200})
  }catch{message.error('打印日志读取失败')}
}

function utcDate(offsetDays:number):string{
  const d=new Date(Date.now()+offsetDays*86400000)
  return d.toISOString().slice(0,10)
}
function rangeParams():{from?:string;to?:string}{
  const r=ranges.find(x=>x.key===rangeKey.value)
  if(!r||r.days===0)return {}
  return {from:utcDate(-(r.days-1)),to:utcDate(1)}
}
const maxDaily=computed(()=>Math.max(1,...daily.value.map(x=>x.total)))
const kpis=computed(()=>{
  const s=summary.value
  if(!s)return []
  return [
    {label:'任务总数',value:s.total,note:'范围内创建'},
    {label:'打印成功',value:s.succeeded,note:'成功率 '+s.successRate+'%'},
    {label:'打印失败',value:s.failed,note:'含待重试'},
    {label:'处理中',value:s.active,note:'队列/打印/重试/待代理'},
    {label:'已取消',value:s.cancelled,note:'人为取消'},
    {label:'打印尝试',value:s.attempts,note:'含重试消耗'}
  ]
})

async function refresh(){
  loading.value=true
  const p=rangeParams()
  try{
    const [s,d,pr,tp]=await Promise.all([
      getReportSummary(p.from,p.to),getReportDaily(p.from,p.to),
      getReportPrinters(p.from,p.to),getReportTemplates(p.from,p.to)
    ])
    summary.value=s;daily.value=d;printers.value=pr;templates.value=tp
  }catch{message.error('报表数据读取失败')}
  finally{loading.value=false}
}
function exportDailyCsv(){
  downloadCsv('print-daily-report.csv',[
    ['日期(UTC)','任务数','成功','失败','已取消','成功率%'],
    ...daily.value.map(x=>[x.date,x.total,x.succeeded,x.failed,x.cancelled,x.successRate])
  ])
}
function exportPrinterCsv(){
  downloadCsv('print-printer-report.csv',[
    ['打印机','任务数','成功','失败','成功率%','最近打印(UTC)'],
    ...printers.value.map(x=>[x.printerId,x.total,x.succeeded,x.failed,x.successRate,x.lastPrintAt])
  ])
}
function exportLogCsv(){
  downloadCsv('print-log.csv',[
    ['时间(UTC)','任务ID','模板编码','业务键','尝试','打印机','结果','消息'],
    ...logs.value.map(x=>[x.createdAt,x.taskId,x.templateCode,x.businessKey,x.attemptNo,x.printerId,x.status,x.message])
  ])
}
onMounted(async()=>{await refresh();await refreshLogs()})
function refreshAll(){refresh();refreshLogs()}
</script>

<template>
<div class="page-head"><div><span class="eyebrow">OPERATIONS REPORT</span><h1>运营报表</h1><p>任务与设备维度统计（PRD 4.10）。时间按 UTC 日分桶；当前打印设备维度来自任务记录。</p></div>
  <a-space>
    <a-radio-group v-model:value="rangeKey" button-style="solid" @change="refreshAll">
      <a-radio-button v-for="r in ranges" :key="r.key" :value="r.key">{{r.label}}</a-radio-button>
    </a-radio-group>
    <a-button @click="refreshAll" :loading="loading">刷新</a-button>
  </a-space>
</div>

<div class="metrics report-metrics">
  <a-card v-for="k in kpis" :key="k.label"><span>{{k.label}}</span><strong>{{k.value}}</strong><em>{{k.note}}</em></a-card>
</div>

<a-card title="按日趋势" style="margin-bottom:16px">
  <template #extra><a-button size="small" @click="exportDailyCsv" :disabled="!daily.length">导出 CSV</a-button></template>
  <a-empty v-if="!daily.length" description="范围内没有打印任务"/>
  <table v-else class="report-table">
    <thead><tr><th>日期(UTC)</th><th>任务数</th><th>成功</th><th>失败</th><th>已取消</th><th style="width:34%">分布</th><th>成功率</th></tr></thead>
    <tbody>
      <tr v-for="row in daily" :key="row.date">
        <td>{{row.date}}</td><td>{{row.total}}</td><td class="ok">{{row.succeeded}}</td><td class="bad">{{row.failed}}</td><td>{{row.cancelled}}</td>
        <td><div class="trend-bar"><div class="seg ok-seg" :style="{width:(row.succeeded/maxDaily*100)+'%'}"/><div class="seg bad-seg" :style="{width:(row.failed/maxDaily*100)+'%'}"/><div class="seg void-seg" :style="{width:((row.total-row.succeeded-row.failed)/maxDaily*100)+'%'}"/></div></td>
        <td>{{row.successRate}}%</td>
      </tr>
    </tbody>
  </table>
</a-card>

<a-card title="设备维度（按任务的打印机记录）" style="margin-bottom:16px">
  <template #extra><a-button size="small" @click="exportPrinterCsv" :disabled="!printers.length">导出 CSV</a-button></template>
  <a-empty v-if="!printers.length" description="范围内没有打印任务"/>
  <table v-else class="report-table">
    <thead><tr><th>打印机</th><th>任务数</th><th>成功</th><th>失败</th><th>成功率</th><th>最近打印(UTC)</th></tr></thead>
    <tbody><tr v-for="p in printers" :key="p.printerId"><td>{{p.printerId}}</td><td>{{p.total}}</td><td class="ok">{{p.succeeded}}</td><td class="bad">{{p.failed}}</td><td>{{p.successRate}}%</td><td>{{(p.lastPrintAt||'').replace('T',' ').slice(0,19)}}</td></tr></tbody>
  </table>
</a-card>

<a-card title="模板维度">
  <a-empty v-if="!templates.length" description="范围内没有打印任务"/>
  <table v-else class="report-table">
    <thead><tr><th>模板编码</th><th>任务数</th><th>成功</th><th>失败</th><th>成功率</th><th>最近打印(UTC)</th></tr></thead>
    <tbody><tr v-for="t in templates" :key="t.templateCode"><td>{{t.templateCode}}</td><td>{{t.total}}</td><td class="ok">{{t.succeeded}}</td><td class="bad">{{t.failed}}</td><td>{{t.successRate}}%</td><td>{{(t.lastPrintAt||'').replace('T',' ').slice(0,19)}}</td></tr></tbody>
  </table>
</a-card>

<a-card title="打印日志（每次打印尝试一条记录）" style="margin-top:16px">
  <template #extra>
    <a-space>
      <a-select v-model:value="logFilter.status" :options="logStatuses" style="width:120px" placeholder="全部结果" @change="refreshLogs"/>
      <a-input-search v-model:value="logFilter.keyword" placeholder="搜索业务键 / 模板编码" style="width:220px" @search="refreshLogs"/>
      <a-button size="small" @click="exportLogCsv" :disabled="!logs.length">导出 CSV</a-button>
    </a-space>
  </template>
  <a-empty v-if="!logs.length" description="没有匹配的打印日志"/>
  <table v-else class="report-table">
    <thead><tr><th>时间(UTC)</th><th>模板</th><th>业务键</th><th>打印机</th><th>尝试</th><th>结果</th><th>消息</th></tr></thead>
    <tbody>
      <tr v-for="l in logs" :key="l.taskId+'-'+l.attemptNo+'-'+l.createdAt">
        <td>{{l.createdAt.replace('T',' ').slice(0,19)}}</td>
        <td>{{l.templateCode}}</td>
        <td>{{l.businessKey}}</td>
        <td>{{l.printerId}}</td>
        <td>#{{l.attemptNo}}</td>
        <td><a-tag :color="l.status==='SUCCESS'?'green':l.status==='FAILED'?'red':'blue'">{{l.status}}</a-tag></td>
        <td>{{l.message}}</td>
      </tr>
    </tbody>
  </table>
</a-card>
</template>

<style scoped>
.report-table{width:100%;border-collapse:collapse;font-size:13px}
.report-table th,.report-table td{border-bottom:1px solid #e8eef3;padding:8px 10px;text-align:left}
.report-table th{color:#6e86a0;font-weight:600;background:#f7fafc}
.report-table td.ok{color:#2e9e6b}.report-table td.bad{color:#d46b6b}
.trend-bar{display:flex;height:14px;border-radius:4px;overflow:hidden;background:#eef2f6}
.seg{height:100%}.ok-seg{background:#5aab7f}.bad-seg{background:#d98a8a}.void-seg{background:#b9c8d6}
</style>
