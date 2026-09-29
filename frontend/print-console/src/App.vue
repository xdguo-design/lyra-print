<script setup lang="ts">
import { computed,defineAsyncComponent,onMounted,reactive,ref } from 'vue'
import { message } from 'ant-design-vue'
const TemplateCenter=defineAsyncComponent(()=>import('./components/TemplateCenter.vue'))
const TemplateStudio=defineAsyncComponent(()=>import('./components/TemplateStudio.vue'))
const ReportView=defineAsyncComponent(()=>import('./components/ReportView.vue'))
const PrintWorkbench=defineAsyncComponent(()=>import('./components/PrintWorkbench.vue'))
const SystemLogView=defineAsyncComponent(()=>import('./components/SystemLogView.vue'))
const PrintNodeView=defineAsyncComponent(()=>import('./components/PrintNodeView.vue'))
const AlertCenterView=defineAsyncComponent(()=>import('./components/AlertCenterView.vue'))
import {
  clearPlatformApiKey,createConnection,getAuthSession,getRuntimeCapabilities,getStoredPlatformApiKey,
  listConnections,listTasks,listTemplates,setPlatformApiKey,testConnection
} from './api'
import type { AuthSession,DataSourceConnection,DatabaseType,PrintTask,PrintTemplate,RuntimeCapabilities } from './types'

const selectedKeys=ref<string[]>(['overview'])
const tasks=ref<PrintTask[]>([])
const taskLoading=ref(false)
const connections=ref<DataSourceConnection[]>([])
const sourceLoading=ref(false)
const templateCount=ref(0)
const currentTemplate=ref<PrintTemplate|null>(null)
const testing=ref(false)
const testPassword=ref('')
const sourceForm=reactive({name:'',dbType:'POSTGRESQL' as DatabaseType,jdbcUrl:'jdbc:postgresql://127.0.0.1:5432/his',username:'',secretRef:'',readOnly:true,enabled:true})
const runtimeCapabilities=ref<RuntimeCapabilities|null>(null)
const authSession=ref<AuthSession|null>(null)
const authOpen=ref(false)
const authKey=ref(getStoredPlatformApiKey())
const authBusy=ref(false)
const canAdmin=computed(()=>authSession.value?.role==='ADMIN')
const canOperate=computed(()=>['OPERATOR','ADMIN'].includes(authSession.value?.role||''))
const jdbcHints:Record<DatabaseType,string>={SQLITE:'jdbc:sqlite:./business.db',MYSQL:'jdbc:mysql://127.0.0.1:3306/his',POSTGRESQL:'jdbc:postgresql://127.0.0.1:5432/his',SQL_SERVER:'jdbc:sqlserver://127.0.0.1:1433;databaseName=his;encrypt=true',ORACLE:'jdbc:oracle:thin:@//127.0.0.1:1521/FREEPDB1'}

const taskMetrics=computed(()=>({
  total:tasks.value.length,
  active:tasks.value.filter(t=>['QUEUED','PRINTING','RETRYING','WAITING_AGENT'].includes(t.status)).length,
  failed:tasks.value.filter(t=>t.status==='FAILED').length,
  success:tasks.value.filter(t=>t.status==='SUCCESS').length
}))
const pageTitle=computed(()=>{
  const map:Record<string,string>={overview:'平台概览',templates:'模板中心',studio:'模板设计器',sources:'数据源',tasks:'打印任务',agents:'打印节点',alerts:'告警中心',logs:'系统日志',reports:'运营报表'}
  return map[selectedKeys.value[0]]||'打印平台'
})


async function bootstrapProtectedData(){
  await Promise.all([refreshTasks(),refreshConnections(),refreshOverview()])
}
async function refreshAuthentication(){
  try{
    runtimeCapabilities.value=await getRuntimeCapabilities()
    if(!runtimeCapabilities.value.authenticationEnabled){
      authSession.value={authenticationEnabled:false,role:'ADMIN'}
      await bootstrapProtectedData()
      return
    }
    if(!getStoredPlatformApiKey()){
      authSession.value=null
      authOpen.value=true
      return
    }
    authSession.value=await getAuthSession()
    await bootstrapProtectedData()
  }catch{
    authSession.value=null
    if(runtimeCapabilities.value?.authenticationEnabled)authOpen.value=true
  }
}
async function submitAuth(){
  if(!authKey.value.trim()){message.warning('请输入 API Key');return}
  authBusy.value=true
  setPlatformApiKey(authKey.value)
  try{
    authSession.value=await getAuthSession()
    authOpen.value=false
    message.success('认证成功 · '+authSession.value.role)
    await bootstrapProtectedData()
  }catch(e:any){
    clearPlatformApiKey()
    message.error(e?.response?.data?.detail||'API Key 无效')
  }finally{authBusy.value=false}
}
function logoutAuth(){
  clearPlatformApiKey()
  authSession.value=null
  tasks.value=[];connections.value=[];templateCount.value=0
  authKey.value=''
  authOpen.value=true
}

function useHint(){sourceForm.jdbcUrl=jdbcHints[sourceForm.dbType]}
async function refreshTasks(){taskLoading.value=true;try{tasks.value=await listTasks()}catch{message.error('打印任务读取失败')}finally{taskLoading.value=false}}
async function refreshConnections(){sourceLoading.value=true;try{connections.value=await listConnections()}catch{message.error('数据源列表读取失败')}finally{sourceLoading.value=false}}
async function refreshOverview(){try{const templates=await listTemplates();templateCount.value=templates.length}catch{}}
async function saveSource(){if(!sourceForm.name||!sourceForm.jdbcUrl){message.warning('请填写名称和 JDBC URL');return}try{const saved=await createConnection({...sourceForm});connections.value.unshift(saved);message.success('数据源连接配置已保存')}catch(e:any){message.error(e?.response?.data?.detail||'保存失败')}}
async function testSource(){testing.value=true;try{const result=await testConnection({dbType:sourceForm.dbType,jdbcUrl:sourceForm.jdbcUrl,username:sourceForm.username,password:testPassword.value,readOnly:sourceForm.readOnly});result.success?message.success((result.databaseProduct||'数据库')+' '+(result.databaseVersion||'')+' · '+result.elapsedMs+'ms'):message.error(result.message)}catch(e:any){message.error(e?.response?.data?.detail||'连接测试失败')}finally{testing.value=false}}
function editTemplate(template:PrintTemplate){currentTemplate.value=template;selectedKeys.value=['studio']}
function templateSaved(template:PrintTemplate){currentTemplate.value=template;refreshOverview()}
function backTemplates(){selectedKeys.value=['templates'];currentTemplate.value=null}
function navigateFromNode(key:'tasks'|'logs'){selectedKeys.value=[key]}
function menuSelect(info:any){if(info.key==='studio'&&!currentTemplate.value){selectedKeys.value=['templates'];return}selectedKeys.value=[info.key]}
onMounted(refreshAuthentication)
</script>

<template>
<a-layout class="app-shell">
  <a-layout-sider v-if="selectedKeys[0]!=='studio'" width="230" theme="light" class="side">
    <div class="brand"><div class="mark">印</div><div><strong>打印平台</strong><small>Print Platform</small></div></div>
    <a-menu mode="inline" :selected-keys="selectedKeys" @select="menuSelect">
      <a-menu-item key="overview">平台概览</a-menu-item>
      <a-menu-item key="templates">模板中心</a-menu-item>
      <a-menu-item key="sources">数据源</a-menu-item>
      <a-menu-item key="tasks">打印任务</a-menu-item>
      <a-menu-item key="agents">打印节点</a-menu-item>
      <a-menu-item key="alerts">告警中心</a-menu-item>
      <a-menu-item key="logs">系统日志</a-menu-item>
      <a-menu-item key="reports">运营报表</a-menu-item>
    </a-menu>
  </a-layout-sider>

  <a-layout-content :class="selectedKeys[0]==='studio'?'studio-content':'content'">
    <template v-if="selectedKeys[0]!=='studio'">
      <div class="top-context">
        <span>独立打印平台 / {{pageTitle}}</span>
        <a-space>
          <a-tag color="blue">SQLite 本地开发</a-tag>
          <a-tag v-if="runtimeCapabilities?.authenticationEnabled" :color="authSession?'green':'orange'">{{authSession?.role||'未认证'}}</a-tag>
          <a-button v-if="runtimeCapabilities?.authenticationEnabled&&authSession" size="small" @click="logoutAuth">切换凭据</a-button>
        </a-space>
      </div>
    </template>

    <template v-if="selectedKeys[0]==='overview'">
      <div class="page-head"><div><span class="eyebrow">PRINT PLATFORM · MVP</span><h1>平台概览</h1><p>当前优先建设平台基础与模板设计器，数据源与打印执行链保持可用。</p></div><a-button @click="refreshOverview">刷新</a-button></div>
      <div class="metrics overview-metrics">
        <a-card @click="selectedKeys=['templates']"><span>模板</span><strong>{{templateCount}}</strong><em>进入模板中心 →</em></a-card>
        <a-card><span>数据源连接</span><strong>{{connections.length}}</strong><em>多数据库连接</em></a-card>
        <a-card><span>打印任务</span><strong>{{tasks.length}}</strong><em>{{taskMetrics.active}} 个处理中</em></a-card>
        <a-card><span>平台存储</span><strong>SQLite</strong><em>本地持久化</em></a-card>
      </div>
      <div class="overview-grid">
        <a-card title="本轮开发重点">
          <a-steps direction="vertical" size="small" :current="2" :items="[
            {title:'平台工程与 SQLite',description:'已完成'},
            {title:'模板中心',description:'模板/草稿/版本'},
            {title:'可视化模板设计器',description:'当前开发重点'},
            {title:'真实打印渲染',description:'后续'}
          ]"/>
        </a-card>
        <a-card title="模板设计能力">
          <div class="capability-grid"><span>拖拽 / 移动 / 缩放</span><span>复制 / 删除</span><span>网格 / 吸附 / 标尺</span><span>图层 / 锁定 / 隐藏</span><span>撤销 / 重做</span><span>纸张 / 方向 / 边距</span><span>数据绑定</span><span>样例数据预览</span><span>导入 / 导出</span><span>草稿 / 审核 / 发布版本</span></div>
          <a-button type="primary" style="margin-top:18px" @click="selectedKeys=['templates']">进入模板中心</a-button>
        </a-card>
      </div>
    </template>

    <TemplateCenter v-else-if="selectedKeys[0]==='templates'" @edit="editTemplate"/>

    <ReportView v-else-if="selectedKeys[0]==='reports'"/>

    <TemplateStudio v-else-if="selectedKeys[0]==='studio' && currentTemplate" :template="currentTemplate" @saved="templateSaved" @back="backTemplates"/>

    <template v-else-if="selectedKeys[0]==='sources'">
      <div class="page-head"><div><span class="eyebrow">MULTI DATABASE</span><h1>数据源连接</h1><p>平台自身使用 SQLite；这里配置外部业务只读数据库。</p></div><a-button @click="refreshConnections">刷新</a-button></div>
      <div class="source-grid">
        <a-card title="新增 / 测试连接">
          <a-form layout="vertical">
            <a-form-item label="名称"><a-input v-model:value="sourceForm.name" placeholder="例如：HIS 主库只读"/></a-form-item>
            <a-form-item label="数据库类型"><a-select v-model:value="sourceForm.dbType" @change="useHint"><a-select-option value="SQLITE">SQLite</a-select-option><a-select-option value="MYSQL">MySQL</a-select-option><a-select-option value="POSTGRESQL">PostgreSQL</a-select-option><a-select-option value="SQL_SERVER">SQL Server</a-select-option><a-select-option value="ORACLE">Oracle</a-select-option></a-select></a-form-item>
            <a-form-item label="JDBC URL"><a-input v-model:value="sourceForm.jdbcUrl"/></a-form-item>
            <a-form-item label="用户名"><a-input v-model:value="sourceForm.username"/></a-form-item>
            <a-form-item label="测试密码"><a-input-password v-model:value="testPassword" placeholder="仅用于本次测试，不保存"/></a-form-item>
            <a-form-item label="Secret Ref"><a-input v-model:value="sourceForm.secretRef" placeholder="env:HIS_DB_PASSWORD"/></a-form-item>
            <a-space><span>只读</span><a-switch v-model:checked="sourceForm.readOnly"/><span>启用</span><a-switch v-model:checked="sourceForm.enabled"/></a-space>
            <div class="form-actions"><a-button :loading="testing" @click="testSource">测试连接</a-button><a-button type="primary" @click="saveSource">保存配置</a-button></div>
          </a-form>
        </a-card>
        <a-card title="已配置连接">
          <a-table :data-source="connections" :loading="sourceLoading" row-key="id" :pagination="false">
            <a-table-column title="名称" data-index="name"/><a-table-column title="类型" data-index="dbType"/><a-table-column title="JDBC URL" data-index="jdbcUrl"/><a-table-column title="用户" data-index="username"/>
            <a-table-column title="策略"><template #default="{record}"><a-tag :color="record.readOnly?'green':'orange'">{{record.readOnly?'只读':'可写'}}</a-tag><a-tag>{{record.enabled?'启用':'停用'}}</a-tag></template></a-table-column>
          </a-table>
        </a-card>
      </div>
    </template>

    <PrintWorkbench v-else-if="selectedKeys[0]==='tasks'"/>

    <PrintNodeView v-else-if="selectedKeys[0]==='agents'" @navigate="navigateFromNode"/>
    <AlertCenterView v-else-if="selectedKeys[0]==='alerts'" :can-operate="canOperate" :can-admin="canAdmin"/>
    <SystemLogView v-else-if="selectedKeys[0]==='logs'" :can-admin="canAdmin"/>

  </a-layout-content>
  <a-modal
    v-model:open="authOpen"
    title="Print Platform 身份认证"
    :closable="false"
    :mask-closable="false"
    :confirm-loading="authBusy"
    ok-text="验证"
    cancel-text="取消"
    :cancel-button-props="{disabled:true}"
    @ok="submitAuth"
  >
    <a-alert type="info" show-icon message="生产 API 已启用服务端 RBAC" description="请输入部署管理员分配的 API Key。Key 仅保存在当前浏览器 localStorage，并通过 Authorization: Bearer 发送。"/>
    <a-form layout="vertical" style="margin-top:14px">
      <a-form-item label="API Key"><a-input-password v-model:value="authKey" autocomplete="current-password" @pressEnter="submitAuth"/></a-form-item>
    </a-form>
  </a-modal>
</a-layout>
</template>