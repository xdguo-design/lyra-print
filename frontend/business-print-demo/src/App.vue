<script setup lang="ts">
import { computed,onMounted,ref } from 'vue'
import { PrintPlatformClient,type PrintTask } from '@print-platform/sdk-core'
import { renderPreview,type PreviewPayload,type PreviewRenderResult } from '@print-platform/preview-browser'
import PlatformPrintPreview from './components/PlatformPrintPreview.vue'
import { DEMO_SCENARIOS,cloneScenarioData,makeBusinessKey,type DemoScenario } from './demo-data'
import { getExtensionHealth,listLocalPrinters,sendPrint,type LocalPrinter } from './lib/extension-bridge'

const platformUrl=ref(import.meta.env.VITE_PRINT_PLATFORM_URL||'http://localhost:8080')
const apiKey=ref('')
const scenario=ref<DemoScenario>(DEMO_SCENARIOS[0])
const editor=ref(JSON.stringify(cloneScenarioData(scenario.value),null,2))
const previewPayload=ref<PreviewPayload|null>(null)
const rendered=ref<PreviewRenderResult|null>(null)
const backendState=ref<'checking'|'online'|'offline'>('checking')
const extensionState=ref<'checking'|'online'|'offline'>('checking')
const printers=ref<LocalPrinter[]>([])
const printerId=ref('')
const copies=ref(1)
const loadingPreview=ref(false)
const printing=ref(false)
const message=ref('')
const lastTask=ref<PrintTask|null>(null)
const activity=ref<string[]>([])

const client=computed(()=>new PrintPlatformClient({
  baseUrl:platformUrl.value.trim(),
  apiKey:apiKey.value.trim()
}))

const canPrint=computed(()=>extensionState.value==='online'&&Boolean(printerId.value)&&Boolean(rendered.value)&&!printing.value)

function log(text:string){
  const stamp=new Date().toLocaleTimeString('zh-CN',{hour12:false})
  activity.value=[`${stamp}  ${text}`,...activity.value].slice(0,12)
}

function parseData(){
  const value=JSON.parse(editor.value)
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('业务数据必须是 JSON 对象')
  return value as Record<string,unknown>
}

async function checkBackend(){
  backendState.value='checking'
  try{
    const response=await fetch(platformUrl.value.replace(/\/$/,'')+'/actuator/health')
    backendState.value=response.ok?'online':'offline'
  }catch{
    backendState.value='offline'
  }
}

async function refreshDevices(){
  extensionState.value='checking'
  const health=await getExtensionHealth()
  if(!health.ok){
    extensionState.value='offline'
    printers.value=[]
    printerId.value=''
    return
  }
  extensionState.value='online'
  const listed=await listLocalPrinters()
  printers.value=listed.ok&&Array.isArray(listed.data)?listed.data:[]
  if(!printers.value.some(p=>p.id===printerId.value)){
    const preferred=printers.value.find(p=>p.isDefault)||printers.value[0]
    printerId.value=preferred?.id||''
  }
}

async function loadPreview(){
  loadingPreview.value=true
  message.value=''
  try{
    const data=parseData()
    const response=await client.value.createPreview({
      templateCode:scenario.value.templateCode,
      inputData:data
    })
    previewPayload.value={
      templateName:response.templateName,
      design:response.design,
      renderData:response.renderData
    }
    backendState.value='online'
    log(`预览已加载：${scenario.value.templateCode} v${response.templateVersion}`)
  }catch(e){
    backendState.value='offline'
    previewPayload.value=null
    rendered.value=null
    message.value=e instanceof Error?e.message:String(e)
    log('预览加载失败')
  }finally{
    loadingPreview.value=false
  }
}

async function selectScenario(next:DemoScenario){
  scenario.value=next
  editor.value=JSON.stringify(cloneScenarioData(next),null,2)
  lastTask.value=null
  await loadPreview()
}

function onRendered(value:PreviewRenderResult){
  rendered.value=value
}

async function testPrint(){
  if(!rendered.value||!printerId.value)return
  printing.value=true
  message.value=''
  try{
    const response=await sendPrint({
      mode:'TEST',
      taskId:'DEMO-TEST-'+Date.now(),
      printerId:printerId.value,
      copies:Math.max(1,copies.value),
      title:scenario.value.title,
      documentHtml:rendered.value.printHtml,
      pageSize:rendered.value.pageSize
    })
    if(!response.ok)throw new Error(response.error||'测试打印失败')
    message.value='测试打印已发送到 Print Agent；测试模式不会创建正式 PrintTask。'
    log(`测试打印已发送：${printerId.value}`)
  }catch(e){
    message.value=e instanceof Error?e.message:String(e)
    log('测试打印失败')
  }finally{
    printing.value=false
  }
}

async function formalPrint(){
  if(!printerId.value)return
  printing.value=true
  message.value=''
  let task:PrintTask|null=null
  try{
    const health=await getExtensionHealth()
    if(!health.ok)throw new Error(health.error||'Print Agent 不在线')
    const data=parseData()
    task=await client.value.createTask({
      templateCode:scenario.value.templateCode,
      businessKey:makeBusinessKey(scenario.value.businessKeyPrefix),
      printerId:printerId.value,
      copies:Math.max(1,copies.value),
      inputData:data
    })
    lastTask.value=task
    log(`正式任务已创建：${task.id}`)
    await client.value.queue(task.id)
    await client.value.start(task.id)

    const documentSnapshot=await client.value.getTaskDocument(task.id)
    if(documentSnapshot.documentKind!=='TEMPLATE'||!documentSnapshot.design||!documentSnapshot.renderData){
      throw new Error('Demo 当前只支持模板类 PrintTask')
    }
    const finalDocument=await renderPreview({
      templateName:documentSnapshot.templateName,
      design:documentSnapshot.design,
      renderData:documentSnapshot.renderData
    })

    const response=await sendPrint({
      mode:'PRODUCTION',
      taskId:task.id,
      printerId:printerId.value,
      copies:Math.max(1,copies.value),
      title:documentSnapshot.templateName,
      documentHtml:finalDocument.printHtml,
      pageSize:finalDocument.pageSize
    })
    if(!response.ok)throw new Error(response.error||'Print Agent 执行失败')
    lastTask.value=await client.value.succeed(task.id)
    message.value=`正式打印完成：${task.id}`
    log(`任务成功：${task.id}`)
  }catch(e){
    const reason=e instanceof Error?e.message:String(e)
    if(task){
      try{lastTask.value=await client.value.fail(task.id,reason)}catch{}
    }
    message.value=reason
    log(`正式打印失败：${reason}`)
  }finally{
    printing.value=false
  }
}

async function reconnect(){
  await Promise.all([checkBackend(),refreshDevices()])
  if(backendState.value==='online')await loadPreview()
}

onMounted(async()=>{
  await Promise.all([checkBackend(),refreshDevices()])
  await loadPreview()
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">P</div>
        <div>
          <strong>Print Platform</strong>
          <span>业务系统接入 Demo</span>
        </div>
      </div>
      <div class="status-group">
        <span class="status" :class="backendState">
          <i></i>平台 {{ backendState==='online'?'在线':backendState==='checking'?'检测中':'离线' }}
        </span>
        <span class="status" :class="extensionState">
          <i></i>扩展 / Agent {{ extensionState==='online'?'在线':extensionState==='checking'?'检测中':'离线' }}
        </span>
        <button class="ghost-button" @click="reconnect">重新检测</button>
      </div>
    </header>

    <main>
      <section class="hero">
        <div>
          <span class="eyebrow">HOST APPLICATION DEMO</span>
          <h1>业务页面直接加载打印组件</h1>
          <p>同一个组件处理 A4、多页报表、80mm 自动高度小票和 70×40 标签；正式打印继续通过浏览器扩展与本机 Print Agent。</p>
        </div>
        <div class="flow-card">
          <span>业务前端</span><b>→</b><span>Preview SDK</span><b>→</b><span>Extension</span><b>→</b><span>Agent</span><b>→</b><span>Printer</span>
        </div>
      </section>

      <section class="scenario-grid">
        <button
          v-for="item in DEMO_SCENARIOS"
          :key="item.id"
          class="scenario-card"
          :class="{active:item.id===scenario.id}"
          @click="selectScenario(item)"
        >
          <span class="scenario-kicker">{{ item.paperText }}</span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.subtitle }}</small>
        </button>
      </section>

      <section class="workspace">
        <aside class="control-panel">
          <div class="panel-section">
            <div class="section-heading">
              <span>连接配置</span>
              <small>Demo 调试用</small>
            </div>
            <label>
              <span>Print Platform</span>
              <input v-model="platformUrl" @change="reconnect" />
            </label>
            <label>
              <span>Operator API Key</span>
              <input v-model="apiKey" type="password" placeholder="开发模式可留空" />
            </label>
            <p class="hint">生产接入应由业务后端 / BFF 保存长期 API Key，浏览器 Demo 仅用于本地验收。</p>
          </div>

          <div class="panel-section">
            <div class="section-heading">
              <span>本机打印</span>
              <small>{{ printers.length }} 台设备</small>
            </div>
            <label>
              <span>打印机</span>
              <select v-model="printerId">
                <option value="">请选择打印机</option>
                <option v-for="printer in printers" :key="printer.id" :value="printer.id">
                  {{ printer.name }}{{ printer.isDefault?' · 默认':'' }}
                </option>
              </select>
            </label>
            <label>
              <span>份数</span>
              <input v-model.number="copies" type="number" min="1" max="99" />
            </label>
            <div class="button-row">
              <button class="secondary-button" :disabled="!canPrint" @click="testPrint">测试打印</button>
              <button class="primary-button" :disabled="!canPrint" @click="formalPrint">
                {{ printing?'打印中…':'正式打印' }}
              </button>
            </div>
          </div>

          <div class="panel-section data-section">
            <div class="section-heading">
              <span>业务数据</span>
              <small>JSON → inputData</small>
            </div>
            <textarea v-model="editor" spellcheck="false"></textarea>
            <button class="secondary-button full" :disabled="loadingPreview" @click="loadPreview">
              {{ loadingPreview?'加载中…':'刷新组件预览' }}
            </button>
          </div>

          <div v-if="message" class="message-card">{{ message }}</div>

          <div v-if="lastTask" class="task-card">
            <span>最近正式任务</span>
            <strong>{{ lastTask.id }}</strong>
            <small>{{ lastTask.status }} · {{ lastTask.templateCode }}</small>
          </div>
        </aside>

        <section class="preview-panel">
          <PlatformPrintPreview
            :payload="previewPayload"
            :frame-height="720"
            @rendered="onRendered"
          />

          <div class="integration-strip">
            <div>
              <span>业务系统只需要</span>
              <code>&lt;PrintPreview :payload="preview" /&gt;</code>
            </div>
            <div>
              <span>纸张尺寸来源</span>
              <strong>Template → PaperModel → 自动缩放</strong>
            </div>
            <div>
              <span>打印尺寸</span>
              <strong>始终使用 mm，预览缩放不进入 printHtml</strong>
            </div>
          </div>
        </section>
      </section>

      <section class="activity-panel">
        <div class="section-heading">
          <span>链路活动</span>
          <small>最近 {{ activity.length }} 条</small>
        </div>
        <div v-if="!activity.length" class="empty-activity">等待预览或打印操作…</div>
        <ol v-else>
          <li v-for="entry in activity" :key="entry">{{ entry }}</li>
        </ol>
      </section>
    </main>
  </div>
</template>
