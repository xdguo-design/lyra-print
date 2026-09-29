<script setup lang="ts">
import { computed,onMounted,ref } from 'vue'
import { message } from 'ant-design-vue'
import { listAgentHeartbeats,listAgentInstances } from '../api'
import type { AgentHeartbeatRecord,AgentInstanceRecord } from '../types'

const emit=defineEmits<{(e:'navigate',key:'tasks'|'logs'):void}>()

const rows=ref<AgentInstanceRecord[]>([])
const loading=ref(false)
const drawerOpen=ref(false)
const selected=ref<AgentInstanceRecord|null>(null)
const history=ref<AgentHeartbeatRecord[]>([])
const historyLoading=ref(false)
const activeTab=ref('overview')

const keyword=ref('')
const statusFilter=ref('ALL')
const healthFilter=ref('ALL')
const osFilter=ref('ALL')
const versionFilter=ref('ALL')

type PrintHealth='HEALTHY'|'DEGRADED'|'OFFLINE'|'UNBOUND'

function spoolerHealthy(value?:string|null){
  const v=(value||'UNKNOWN').toUpperCase()
  return ['RUNNING','UNSUPPORTED'].includes(v)
}
function printHealth(row:AgentInstanceRecord):PrintHealth{
  if(row.status==='OFFLINE')return 'OFFLINE'
  if(row.status==='UNKNOWN')return 'DEGRADED'
  if((row.printerCount||0)<=0)return 'UNBOUND'
  if(!spoolerHealthy(row.spoolerStatus))return 'DEGRADED'
  return 'HEALTHY'
}
function businessState(row:AgentInstanceRecord){
  if(row.status==='OFFLINE')return 'OFFLINE'
  if(row.status==='UNKNOWN')return 'DEGRADED'
  if((row.activeJobs||0)>0)return 'BUSY'
  return 'ONLINE'
}
function stateLabel(row:AgentInstanceRecord){
  return ({ONLINE:'在线',BUSY:'忙碌',DEGRADED:'异常',OFFLINE:'离线'} as Record<string,string>)[businessState(row)]
}
function healthLabel(row:AgentInstanceRecord){
  return ({HEALTHY:'打印链路正常',DEGRADED:'打印链路异常',OFFLINE:'节点离线',UNBOUND:'未发现打印机'} as Record<PrintHealth,string>)[printHealth(row)]
}
function stateClass(row:AgentInstanceRecord){return 'state-'+businessState(row).toLowerCase()}
function healthClass(row:AgentInstanceRecord){return 'health-'+printHealth(row).toLowerCase()}
function fmt(value?:string|null){
  if(!value)return '—'
  const d=new Date(value)
  return Number.isFinite(d.getTime())?d.toLocaleString():value
}
function ago(value?:string|null){
  if(!value)return '—'
  const ts=new Date(value).getTime()
  if(!Number.isFinite(ts))return value
  const diff=Math.max(0,Date.now()-ts)
  const sec=Math.floor(diff/1000)
  if(sec<60)return sec+' 秒前'
  const min=Math.floor(sec/60)
  if(min<60)return min+' 分钟前'
  const hr=Math.floor(min/60)
  return hr<24?hr+' 小时前':Math.floor(hr/24)+' 天前'
}
function percent(value?:number|null){return value==null?'—':value.toFixed(1)+'%'}
function nodeId(row:AgentInstanceRecord){return row.agentId+' / '+row.instanceId}
function rowKey(row:AgentInstanceRecord){return row.agentId+'::'+row.instanceId}
function nodeName(row:AgentInstanceRecord){return row.hostName||row.instanceId||row.agentId}
function shortOs(value:string){
  if(!value)return '未知系统'
  const v=value.toLowerCase()
  if(v.includes('win'))return 'Windows'
  if(v.includes('darwin')||v.includes('mac'))return 'macOS'
  if(v.includes('linux'))return 'Linux'
  return value.split(' ')[0]
}

const osOptions=computed(()=>[...new Set(rows.value.map(x=>shortOs(x.osName)).filter(Boolean))].sort())
const versionOptions=computed(()=>[...new Set(rows.value.map(x=>x.agentVersion).filter(Boolean))].sort())

const metrics=computed(()=>({
  total:rows.value.length,
  online:rows.value.filter(x=>['ONLINE','BUSY'].includes(businessState(x))).length,
  busy:rows.value.filter(x=>businessState(x)==='BUSY').length,
  degraded:rows.value.filter(x=>['DEGRADED','UNBOUND'].includes(printHealth(x))).length,
  offline:rows.value.filter(x=>businessState(x)==='OFFLINE').length,
  printers:rows.value.reduce((sum,x)=>sum+(x.printerCount||0),0),
  activeJobs:rows.value.reduce((sum,x)=>sum+(x.activeJobs||0),0),
  queuedJobs:rows.value.reduce((sum,x)=>sum+(x.queuedJobs||0),0)
}))
const healthRate=computed(()=>{
  if(!metrics.value.total)return 0
  const healthy=rows.value.filter(x=>x.status==='ONLINE'&&printHealth(x)==='HEALTHY').length
  return Number(((healthy/metrics.value.total)*100).toFixed(1))
})
const filteredRows=computed(()=>rows.value.filter(row=>{
  const q=keyword.value.trim().toLowerCase()
  if(q&&![row.agentId,row.instanceId,row.hostName,row.ipAddress,row.osName,row.agentVersion].filter(Boolean).some(v=>String(v).toLowerCase().includes(q)))return false
  if(statusFilter.value!=='ALL'&&businessState(row)!==statusFilter.value)return false
  if(healthFilter.value!=='ALL'&&printHealth(row)!==healthFilter.value)return false
  if(osFilter.value!=='ALL'&&shortOs(row.osName)!==osFilter.value)return false
  if(versionFilter.value!=='ALL'&&row.agentVersion!==versionFilter.value)return false
  return true
}))

function resetFilters(){
  keyword.value=''
  statusFilter.value='ALL'
  healthFilter.value='ALL'
  osFilter.value='ALL'
  versionFilter.value='ALL'
}

async function load(){
  loading.value=true
  try{
    rows.value=await listAgentInstances()
    if(selected.value){
      const latest=rows.value.find(x=>x.agentId===selected.value?.agentId&&x.instanceId===selected.value?.instanceId)
      if(latest)selected.value=latest
    }
  }catch(e:any){message.error(e?.response?.data?.detail||'打印节点读取失败')}
  finally{loading.value=false}
}
async function loadHistory(row:AgentInstanceRecord){
  historyLoading.value=true
  try{history.value=await listAgentHeartbeats(row.agentId,row.instanceId,120)}
  catch(e:any){message.error(e?.response?.data?.detail||'节点心跳历史读取失败')}
  finally{historyLoading.value=false}
}
async function open(row:AgentInstanceRecord){
  selected.value=row
  activeTab.value='overview'
  drawerOpen.value=true
  await loadHistory(row)
}
async function reloadSelected(){
  await load()
  if(selected.value)await loadHistory(selected.value)
}
async function copyNodeId(row:AgentInstanceRecord){
  try{
    await navigator.clipboard.writeText(nodeId(row))
    message.success('节点标识已复制')
  }catch{message.warning('浏览器未允许复制，请手动复制')}
}
function go(key:'tasks'|'logs'){drawerOpen.value=false;emit('navigate',key)}

onMounted(load)
</script>

<template>
  <div class="node-view">
    <section class="node-hero">
      <div class="hero-copy">
        <span class="eyebrow">PRINT NODE · RUNTIME</span>
        <h1>打印节点</h1>
        <p>聚焦“能不能接单、能不能打印、打印链路是否健康”。通用 Agent 的模型、Skills、Tools、Memory 与 Workflow 不在这里管理。</p>
      </div>
      <div class="hero-actions">
        <div class="health-pill"><span class="pulse-dot"></span><strong>{{healthRate}}%</strong><small>节点健康度</small></div>
        <a-button :loading="loading" @click="load">刷新状态</a-button>
      </div>
    </section>

    <section class="metric-grid">
      <div class="metric-card primary">
        <div class="metric-icon">◎</div><div><span>节点总数</span><strong>{{metrics.total}}</strong><small>{{metrics.printers}} 台打印机</small></div>
      </div>
      <div class="metric-card">
        <div class="metric-icon good">✓</div><div><span>节点在线</span><strong>{{metrics.online}}</strong><small>{{metrics.busy}} 个节点忙碌</small></div>
      </div>
      <div class="metric-card" :class="{attention:metrics.degraded>0}">
        <div class="metric-icon warn">!</div><div><span>链路异常</span><strong>{{metrics.degraded}}</strong><small>需检查 Spooler / 心跳</small></div>
      </div>
      <div class="metric-card" :class="{danger:metrics.offline>0}">
        <div class="metric-icon bad">×</div><div><span>离线</span><strong>{{metrics.offline}}</strong><small>超过心跳阈值</small></div>
      </div>
      <div class="metric-card">
        <div class="metric-icon queue">↻</div><div><span>当前负载</span><strong>{{metrics.activeJobs}}</strong><small>{{metrics.queuedJobs}} 个任务排队</small></div>
      </div>
    </section>

    <section class="filter-panel">
      <div class="filter-row">
        <a-input v-model:value="keyword" allow-clear class="search-box" placeholder="搜索节点名称、Node ID、IP、主机名、版本…">
          <template #prefix>⌕</template>
        </a-input>
        <a-select v-model:value="statusFilter" class="filter-select">
          <a-select-option value="ALL">全部状态</a-select-option>
          <a-select-option value="ONLINE">在线</a-select-option>
          <a-select-option value="BUSY">忙碌</a-select-option>
          <a-select-option value="DEGRADED">异常</a-select-option>
          <a-select-option value="OFFLINE">离线</a-select-option>
        </a-select>
        <a-select v-model:value="healthFilter" class="filter-select">
          <a-select-option value="ALL">全部打印链路</a-select-option>
          <a-select-option value="HEALTHY">链路正常</a-select-option>
          <a-select-option value="DEGRADED">链路异常</a-select-option>
          <a-select-option value="UNBOUND">未发现打印机</a-select-option>
          <a-select-option value="OFFLINE">节点离线</a-select-option>
        </a-select>
        <a-select v-model:value="osFilter" class="filter-select">
          <a-select-option value="ALL">全部系统</a-select-option>
          <a-select-option v-for="os in osOptions" :key="os" :value="os">{{os}}</a-select-option>
        </a-select>
        <a-select v-model:value="versionFilter" class="filter-select">
          <a-select-option value="ALL">全部版本</a-select-option>
          <a-select-option v-for="version in versionOptions" :key="version" :value="version">{{version}}</a-select-option>
        </a-select>
        <a-button @click="resetFilters">重置</a-button>
      </div>
      <div class="filter-summary">
        <span>显示 <strong>{{filteredRows.length}}</strong> / {{rows.length}} 个节点</span>
        <span>·</span>
        <span>状态由心跳、任务负载与打印 Spooler 联合判断</span>
      </div>
    </section>

    <a-card class="node-table-card" :body-style="{padding:'0'}">
      <a-table :data-source="filteredRows" :loading="loading" :row-key="rowKey" :pagination="{pageSize:12,showSizeChanger:false}" :scroll="{x:1320}">
        <a-table-column title="打印节点" :width="260" fixed="left">
          <template #default="{record}">
            <button class="node-name-button" @click="open(record)">
              <span class="node-avatar">{{nodeName(record).slice(0,1).toUpperCase()}}</span>
              <span><strong>{{nodeName(record)}}</strong><small class="mono">{{record.agentId}} · {{record.instanceId}}</small></span>
            </button>
          </template>
        </a-table-column>
        <a-table-column title="节点状态" :width="116">
          <template #default="{record}"><span class="state-chip" :class="stateClass(record)"><i></i>{{stateLabel(record)}}</span></template>
        </a-table-column>
        <a-table-column title="打印链路" :width="150">
          <template #default="{record}">
            <span class="health-text" :class="healthClass(record)">{{healthLabel(record)}}</span>
            <div class="sub">Spooler {{record.spoolerStatus||'UNKNOWN'}}</div>
          </template>
        </a-table-column>
        <a-table-column title="主机 / IP" :width="220">
          <template #default="{record}"><strong class="table-main">{{record.hostName}}</strong><div class="sub">{{record.ipAddress||'未上报 IP'}} · {{shortOs(record.osName)}}</div></template>
        </a-table-column>
        <a-table-column title="客户端" :width="130">
          <template #default="{record}"><span class="version-pill">v{{String(record.agentVersion||'—').replace(/^v/i,'')}}</span><div class="sub">{{record.osName}}</div></template>
        </a-table-column>
        <a-table-column title="打印机" :width="100">
          <template #default="{record}"><strong class="numeric">{{record.printerCount}}</strong><div class="sub">本机发现</div></template>
        </a-table-column>
        <a-table-column title="任务负载" :width="145">
          <template #default="{record}"><span><b>{{record.activeJobs}}</b> 活跃</span><div class="sub">{{record.queuedJobs}} 排队</div></template>
        </a-table-column>
        <a-table-column title="资源" :width="155">
          <template #default="{record}">
            <div class="resource-line"><span>CPU</span><b>{{percent(record.cpuUsage)}}</b></div>
            <div class="resource-line"><span>内存</span><b>{{percent(record.memoryUsage)}}</b></div>
          </template>
        </a-table-column>
        <a-table-column title="最后心跳" :width="175">
          <template #default="{record}"><strong class="table-main">{{ago(record.lastHeartbeatAt)}}</strong><div class="sub">{{fmt(record.lastHeartbeatAt)}}</div></template>
        </a-table-column>
        <a-table-column title="操作" fixed="right" :width="190">
          <template #default="{record}">
            <a-space>
              <a-button size="small" type="primary" ghost @click="open(record)">详情</a-button>
              <a-button size="small" @click="go('tasks')">任务</a-button>
              <a-dropdown>
                <a-button size="small">更多 ···</a-button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item @click="go('logs')">查看系统日志</a-menu-item>
                    <a-menu-item @click="copyNodeId(record)">复制节点标识</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </a-space>
          </template>
        </a-table-column>
      </a-table>
    </a-card>

    <a-drawer v-model:open="drawerOpen" width="820" class="node-drawer">
      <template #title>
        <div v-if="selected" class="drawer-title">
          <span class="node-avatar large">{{nodeName(selected).slice(0,1).toUpperCase()}}</span>
          <div><strong>{{nodeName(selected)}}</strong><small>{{nodeId(selected)}}</small></div>
        </div>
      </template>
      <template #extra>
        <a-space><a-button size="small" :loading="loading||historyLoading" @click="reloadSelected">刷新</a-button><a-button size="small" @click="go('tasks')">查看任务</a-button></a-space>
      </template>

      <template v-if="selected">
        <div class="drawer-status-strip">
          <span class="state-chip" :class="stateClass(selected)"><i></i>{{stateLabel(selected)}}</span>
          <span class="health-text" :class="healthClass(selected)">{{healthLabel(selected)}}</span>
          <span class="drawer-spacer"></span>
          <span>最后心跳 {{ago(selected.lastHeartbeatAt)}}</span>
        </div>

        <a-tabs v-model:activeKey="activeTab" class="node-tabs">
          <a-tab-pane key="overview" tab="概览">
            <div class="drawer-metrics">
              <div><span>活跃任务</span><strong>{{selected.activeJobs}}</strong></div>
              <div><span>排队任务</span><strong>{{selected.queuedJobs}}</strong></div>
              <div><span>本机打印机</span><strong>{{selected.printerCount}}</strong></div>
              <div><span>客户端版本</span><strong class="version-strong">v{{String(selected.agentVersion||'—').replace(/^v/i,'')}}</strong></div>
            </div>

            <div class="section-title"><strong>节点基础信息</strong><span>打印执行端身份与运行环境</span></div>
            <a-descriptions bordered size="small" :column="2">
              <a-descriptions-item label="节点名称">{{nodeName(selected)}}</a-descriptions-item>
              <a-descriptions-item label="Agent ID"><span class="mono">{{selected.agentId}}</span></a-descriptions-item>
              <a-descriptions-item label="Instance ID"><span class="mono">{{selected.instanceId}}</span></a-descriptions-item>
              <a-descriptions-item label="主机名">{{selected.hostName}}</a-descriptions-item>
              <a-descriptions-item label="IP 地址">{{selected.ipAddress||'未上报'}}</a-descriptions-item>
              <a-descriptions-item label="操作系统">{{selected.osName}}</a-descriptions-item>
              <a-descriptions-item label="注册时间">{{fmt(selected.registeredAt)}}</a-descriptions-item>
              <a-descriptions-item label="最后更新">{{fmt(selected.updatedAt)}}</a-descriptions-item>
              <a-descriptions-item label="最后心跳" :span="2">{{fmt(selected.lastHeartbeatAt)}}（{{ago(selected.lastHeartbeatAt)}}）</a-descriptions-item>
            </a-descriptions>

            <div class="section-title"><strong>打印环境</strong><span>只展示打印平台已真实采集的数据</span></div>
            <div class="capability-grid">
              <div class="capability-card">
                <span>打印机发现</span><strong>{{selected.printerCount}} 台</strong><small>由节点心跳上报</small>
              </div>
              <div class="capability-card">
                <span>Windows Spooler</span><strong>{{selected.spoolerStatus||'UNKNOWN'}}</strong><small>{{spoolerHealthy(selected.spoolerStatus)?'服务状态正常或无需监控':'需要检查系统打印服务'}}</small>
              </div>
              <div class="capability-card">
                <span>任务执行</span><strong>{{selected.activeJobs+selected.queuedJobs}}</strong><small>{{selected.activeJobs}} 活跃 / {{selected.queuedJobs}} 排队</small>
              </div>
            </div>

            <a-alert class="boundary-alert" type="info" show-icon message="页面边界" description="这里管理打印链路中的执行节点健康度。Agent 的模型、角色、Skills、Tools、Memory、Knowledge 与 Workflow 由统一 Agent 平台负责。"/>
          </a-tab-pane>

          <a-tab-pane key="runtime" tab="运行状态">
            <div class="runtime-grid">
              <div class="runtime-card"><span>节点心跳</span><strong :class="selected.status==='ONLINE'?'ok-text':'warn-text'">{{selected.status==='ONLINE'?'正常':selected.status}}</strong><small>{{ago(selected.lastHeartbeatAt)}}</small></div>
              <div class="runtime-card"><span>打印服务</span><strong :class="spoolerHealthy(selected.spoolerStatus)?'ok-text':'warn-text'">{{selected.spoolerStatus||'UNKNOWN'}}</strong><small>系统 Spooler</small></div>
              <div class="runtime-card"><span>CPU</span><strong>{{percent(selected.cpuUsage)}}</strong><a-progress :percent="selected.cpuUsage||0" size="small" :show-info="false"/></div>
              <div class="runtime-card"><span>内存</span><strong>{{percent(selected.memoryUsage)}}</strong><a-progress :percent="selected.memoryUsage||0" size="small" :show-info="false"/></div>
            </div>
            <div class="section-title"><strong>节点协议已上报能力</strong><span>不根据设备类型臆测未上报能力</span></div>
            <div class="reported-capabilities">
              <a-tag color="blue">心跳监控</a-tag>
              <a-tag color="blue">任务负载</a-tag>
              <a-tag color="blue">打印机数量</a-tag>
              <a-tag :color="selected.spoolerStatus==='UNSUPPORTED'?'default':'blue'">Spooler 状态</a-tag>
              <a-tag color="blue">CPU / 内存</a-tag>
            </div>
            <a-alert style="margin-top:18px" type="warning" show-icon message="暂不伪造远程控制操作" description="当前平台 API 只提供节点心跳、列表与历史查询，没有节点暂停、重启、远程测试打印等控制接口，因此本页不展示无效按钮。"/>
          </a-tab-pane>

          <a-tab-pane key="heartbeats" tab="心跳历史">
            <a-table :data-source="history" :loading="historyLoading" row-key="id" size="small" :pagination="{pageSize:15,showSizeChanger:false}">
              <a-table-column title="时间" :width="190"><template #default="{record}">{{fmt(record.createdAt)}}</template></a-table-column>
              <a-table-column title="CPU" :width="90"><template #default="{record}">{{percent(record.cpuUsage)}}</template></a-table-column>
              <a-table-column title="内存" :width="90"><template #default="{record}">{{percent(record.memoryUsage)}}</template></a-table-column>
              <a-table-column title="任务" :width="110"><template #default="{record}">{{record.activeJobs}} / {{record.queuedJobs}}</template></a-table-column>
              <a-table-column title="打印机" data-index="printerCount" :width="85"/>
              <a-table-column title="Spooler" data-index="spoolerStatus" :width="120"/>
              <a-table-column title="版本" data-index="agentVersion"/>
            </a-table>
          </a-tab-pane>
        </a-tabs>
      </template>
    </a-drawer>
  </div>
</template>

<style scoped>
.node-view{min-width:0}
.node-hero{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:28px;margin:0 0 18px;padding:26px 28px;border:1px solid #dceaff;border-radius:24px;background:
  radial-gradient(circle at 88% 18%,rgba(74,144,255,.22),transparent 27%),
  linear-gradient(125deg,#ffffff 0%,#f4f9ff 48%,#eaf4ff 100%);box-shadow:0 18px 50px rgba(57,103,169,.09);overflow:hidden}
.node-hero:after{content:"";position:absolute;right:-35px;bottom:-75px;width:240px;height:240px;border:1px solid rgba(53,127,255,.13);border-radius:50%;box-shadow:0 0 0 28px rgba(53,127,255,.035),0 0 0 58px rgba(53,127,255,.025)}
.hero-copy{position:relative;z-index:1;max-width:760px}.eyebrow{display:block;margin-bottom:6px;color:#1769e0;font-size:12px;font-weight:800;letter-spacing:.12em}.hero-copy h1{margin:0;color:#102449;font-size:30px;line-height:1.2}.hero-copy p{margin:10px 0 0;color:#627896;line-height:1.75}
.hero-actions{position:relative;z-index:1;display:flex;align-items:center;gap:12px}.health-pill{display:grid;grid-template-columns:auto auto;grid-template-rows:auto auto;align-items:center;column-gap:8px;padding:8px 14px;border:1px solid rgba(39,121,237,.15);border-radius:16px;background:rgba(255,255,255,.72);backdrop-filter:blur(10px)}.health-pill .pulse-dot{grid-row:1/3;width:10px;height:10px;border-radius:50%;background:#1fc58a;box-shadow:0 0 0 5px rgba(31,197,138,.12)}.health-pill strong{color:#154eaa;font-size:16px}.health-pill small{color:#7f91aa;font-size:10px}
.metric-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}.metric-card{display:flex;align-items:center;gap:12px;min-height:94px;padding:16px;border:1px solid #e2ebf7;border-radius:18px;background:rgba(255,255,255,.88);box-shadow:0 10px 28px rgba(34,75,130,.055)}.metric-card.primary{border-color:#d6e7ff;background:linear-gradient(135deg,#f7fbff,#edf6ff)}.metric-card.attention{border-color:#ffe0aa;background:#fffdf8}.metric-card.danger{border-color:#ffd6d3;background:#fffafa}.metric-icon{display:flex;align-items:center;justify-content:center;flex:0 0 42px;height:42px;border-radius:14px;background:#eaf3ff;color:#2174e7;font-size:21px;font-weight:800}.metric-icon.good{background:#e8fbf3;color:#11a970}.metric-icon.warn{background:#fff4d8;color:#c88405}.metric-icon.bad{background:#ffecec;color:#df4c4c}.metric-icon.queue{background:#f1edff;color:#7657db}.metric-card span{display:block;color:#748aa4;font-size:12px}.metric-card strong{display:block;margin-top:2px;color:#132e55;font-size:24px;line-height:1.15}.metric-card small{display:block;margin-top:3px;color:#8ca0b6;font-size:11px}
.filter-panel{margin-bottom:14px;padding:14px 16px;border:1px solid #e2ebf7;border-radius:18px;background:#fff}.filter-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.search-box{width:min(360px,100%)}.filter-select{width:150px}.filter-summary{display:flex;align-items:center;gap:8px;margin-top:10px;color:#8aa0b8;font-size:11px}.filter-summary strong{color:#246ecb}
.node-table-card{border:1px solid #e1eaf6;border-radius:20px;overflow:hidden;box-shadow:0 16px 38px rgba(37,76,128,.07)}
.node-name-button{display:flex;align-items:center;gap:10px;width:100%;padding:0;border:0;background:none;text-align:left;cursor:pointer}.node-name-button strong{display:block;color:#17345e;font-size:13px}.node-name-button small{display:block;margin-top:3px;color:#8799ae;font-size:10px}.node-avatar{display:inline-flex;align-items:center;justify-content:center;flex:0 0 34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#dfefff,#f0eaff);color:#196bdc;font-weight:800;box-shadow:inset 0 0 0 1px rgba(41,112,220,.08)}.node-avatar.large{flex-basis:42px;height:42px;border-radius:14px;font-size:18px}
.state-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:700}.state-chip i{width:7px;height:7px;border-radius:50%;background:currentColor}.state-online{background:#eafaf4;color:#14966a}.state-busy{background:#ebf3ff;color:#1d69d5}.state-degraded{background:#fff4df;color:#b97800}.state-offline{background:#f1f3f6;color:#7a8798}.health-text{font-size:12px;font-weight:700}.health-healthy{color:#16966b}.health-degraded{color:#b57800}.health-offline{color:#7e8a99}.health-unbound{color:#8a65d2}.table-main{color:#334f71;font-size:12px}.sub{margin-top:3px;color:#8b9daf;font-size:10px}.mono{font-family:Consolas,"SFMono-Regular",monospace}.numeric{color:#173d73;font-size:17px}.version-pill{display:inline-block;padding:2px 7px;border-radius:8px;background:#eef5ff;color:#236bce;font-size:11px;font-weight:700}.resource-line{display:flex;align-items:center;justify-content:space-between;max-width:110px;color:#7e91a8;font-size:10px}.resource-line+ .resource-line{margin-top:3px}.resource-line b{color:#365774;font-size:11px}
.drawer-title{display:flex;align-items:center;gap:11px}.drawer-title strong{display:block;color:#143157;font-size:15px}.drawer-title small{display:block;margin-top:3px;color:#8799af;font-family:Consolas,"SFMono-Regular",monospace;font-size:10px}.drawer-status-strip{display:flex;align-items:center;gap:12px;margin:-4px 0 14px;padding:11px 13px;border:1px solid #e2ebf7;border-radius:14px;background:#f8fbff;color:#758ba5;font-size:11px}.drawer-spacer{flex:1}.node-tabs :deep(.ant-tabs-nav){margin-bottom:18px}.drawer-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}.drawer-metrics>div{padding:14px;border:1px solid #e4edf7;border-radius:14px;background:linear-gradient(150deg,#fff,#f7fbff)}.drawer-metrics span{display:block;color:#8095ad;font-size:10px}.drawer-metrics strong{display:block;margin-top:5px;color:#173d72;font-size:22px}.drawer-metrics .version-strong{font-size:16px}.section-title{display:flex;align-items:baseline;gap:10px;margin:22px 0 10px}.section-title strong{color:#17375f;font-size:13px}.section-title span{color:#91a2b5;font-size:10px}.capability-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.capability-card{padding:14px;border:1px solid #e4edf7;border-radius:14px;background:#fbfdff}.capability-card span{display:block;color:#8296ad;font-size:10px}.capability-card strong{display:block;margin:5px 0 3px;color:#1b4b86;font-size:15px}.capability-card small{color:#91a1b4;font-size:10px}.boundary-alert{margin-top:18px}.runtime-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.runtime-card{padding:16px;border:1px solid #e3ebf5;border-radius:15px;background:#fbfdff}.runtime-card>span{display:block;color:#7f93aa;font-size:10px}.runtime-card>strong{display:block;margin:5px 0 7px;color:#264b77;font-size:18px}.runtime-card>small{color:#95a5b7;font-size:10px}.ok-text{color:#14966a!important}.warn-text{color:#ba7a00!important}.reported-capabilities{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:1200px){.metric-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:900px){.node-hero{flex-direction:column}.hero-actions{width:100%;justify-content:space-between}.metric-grid{grid-template-columns:repeat(2,1fr)}.drawer-metrics,.capability-grid,.runtime-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.metric-grid{grid-template-columns:1fr}.filter-select,.search-box{width:100%}.drawer-metrics,.capability-grid,.runtime-grid{grid-template-columns:1fr}}
</style>
