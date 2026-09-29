<script setup lang="ts">
import { computed,onMounted,reactive,ref } from 'vue'
import { message,Modal } from 'ant-design-vue'
import CloudTemplateMarket from './CloudTemplateMarket.vue'
import {
  cloneTemplate,createTemplate,disableTemplate,getCloudTemplateStatus,installCloudTemplate,
  listCloudTemplates,listTemplateAudit,listTemplateInstallations,listTemplateReleases,listTemplates,listTemplateVersions,
  refreshTemplateLicense,rollbackTemplate,uploadCloudTemplate,validateTemplate
} from '../api'
import type {
  CloudTemplateCatalogStatus,CloudTemplateSummary,DocumentType,PrintTemplate,PrintTemplateVersion,ReleaseScopeType,
  TemplateAuditEvent,TemplateInstallation,TemplateRelease,TemplateValidationResult
} from '../types'

const emit=defineEmits<{(e:'edit',value:PrintTemplate):void}>()
const templates=ref<PrintTemplate[]>([])
const cloudTemplates=ref<CloudTemplateSummary[]>([])
const cloudStatus=ref<CloudTemplateCatalogStatus|null>(null)
const installations=ref<TemplateInstallation[]>([])
const storageTab=ref<'local'|'cloud'>('local')
const loading=ref(false)
const cloudLoading=ref(false)
const cloudActionKey=ref('')
const createOpen=ref(false)
const versionsOpen=ref(false)
const auditOpen=ref(false)
const validationOpen=ref(false)
const versions=ref<PrintTemplateVersion[]>([])
const releases=ref<TemplateRelease[]>([])
const audits=ref<TemplateAuditEvent[]>([])
const validation=ref<TemplateValidationResult|null>(null)
const activeTemplate=ref<PrintTemplate|null>(null)
const rollbackOpen=ref(false)
const rollbackForm=reactive<{versionNo:number;changeNote:string;scopeType:ReleaseScopeType;scopeValues:string}>({versionNo:1,changeNote:'',scopeType:'ALL',scopeValues:''})
const form=reactive({code:'',name:'',documentType:'FORM' as DocumentType})

const statusText:Record<string,string>={DRAFT:'草稿',TESTING:'测试中',REVIEWING:'审核中',PUBLISHED:'已发布',DISABLED:'已停用'}
const statusColor:Record<string,string>={DRAFT:'blue',TESTING:'cyan',REVIEWING:'orange',PUBLISHED:'green',DISABLED:'default'}
const docText:Record<DocumentType,string>={FORM:'普通表单',INVOICE:'发票',RECEIPT:'收据',EXPENSE_LIST:'费用清单',POS_RECEIPT:'小票',LABEL:'标签',REPORT:'多页报告'}
const stats=computed(()=>({
  total:templates.value.length,
  published:templates.value.filter(t=>t.status==='PUBLISHED').length,
  drafts:templates.value.filter(t=>t.status==='DRAFT').length,
  reviewing:templates.value.filter(t=>['TESTING','REVIEWING'].includes(t.status)).length,
  cloud:cloudTemplates.value.length
}))

function docLabel(type:DocumentType){return docText[type]||type}
function releaseForVersion(versionNo:number){return releases.value.find(r=>r.versionNo===versionNo)}
function scopeLabel(r?:TemplateRelease){
  if(!r)return '—'
  const values=Array.isArray(r.scopeValues)?r.scopeValues:[]
  return r.scopeType==='ALL'?'全部':r.scopeType+' · '+values.join(', ')
}

async function refresh(){
  loading.value=true
  try{templates.value=await listTemplates()}catch{message.error('模板列表读取失败')}
  finally{loading.value=false}
}
async function refreshCloud(showError=false){
  cloudLoading.value=true
  try{
    cloudStatus.value=await getCloudTemplateStatus()
    if(cloudStatus.value.available){
      ;[cloudTemplates.value,installations.value]=await Promise.all([listCloudTemplates(),listTemplateInstallations()])
    }else{
      cloudTemplates.value=[]
      installations.value=[]
    }
  }catch(e:any){
    cloudTemplates.value=[]
    if(showError)message.error(e?.response?.data?.detail||'在线模板库读取失败')
  }finally{cloudLoading.value=false}
}
async function refreshAll(){await Promise.all([refresh(),refreshCloud(false)])}
async function uploadOnline(t:PrintTemplate){
  if(t.status!=='PUBLISHED'||!t.publishedVersion){message.warning('只有已发布模板可以上传在线模板库');return}
  cloudActionKey.value='upload:'+t.id
  try{
    const uploaded=await uploadCloudTemplate(t.id)
    message.success('已上传在线：'+uploaded.name+' v'+uploaded.versionNo)
    await refreshCloud(true)
    storageTab.value='cloud'
  }catch(e:any){message.error(e?.response?.data?.detail||'上传在线模板失败')}
  finally{cloudActionKey.value=''}
}
function installed(t:CloudTemplateSummary){return installations.value.find(i=>i.cloudTemplateCode===t.code)}
async function installOnline(t:CloudTemplateSummary){
  if(t.accessModel==='SUBSCRIPTION'&&!t.entitled){
    message.warning('当前账号没有该模板的有效订阅授权')
    return
  }
  cloudActionKey.value='install:'+t.code+':'+t.versionNo
  try{
    const result=await installCloudTemplate(t.code,t.versionNo)
    const index=templates.value.findIndex(x=>x.id===result.template.id)
    if(index>=0)templates.value[index]=result.template
    else templates.value.unshift(result.template)
    await refreshCloud(true)
    message.success((installed(t)?'在线模板已更新':'在线模板已安装')+'：'+result.template.name)
  }catch(e:any){message.error(e?.response?.data?.detail||'在线模板安装失败')}
  finally{cloudActionKey.value=''}
}
async function refreshLicense(t:CloudTemplateSummary){
  const current=installed(t)
  if(!current)return
  cloudActionKey.value='license:'+t.code
  try{
    await refreshTemplateLicense(current.localTemplateId)
    await refreshCloud(true)
    message.success('授权状态已刷新')
  }catch(e:any){message.error(e?.response?.data?.detail||'授权刷新失败')}
  finally{cloudActionKey.value=''}
}
async function create(){
  if(!form.code||!form.name){message.warning('请输入模板编码和名称');return}
  try{
    const t=await createTemplate(form);templates.value.unshift(t);createOpen.value=false
    form.code='';form.name='';form.documentType='FORM'
    message.success('模板已创建');emit('edit',t)
  }catch(e:any){message.error(e?.response?.data?.detail||'创建失败')}
}
async function clone(t:PrintTemplate){
  try{const c=await cloneTemplate(t.id);templates.value.unshift(c);message.success('模板已复制')}
  catch(e:any){message.error(e?.response?.data?.detail||'复制失败')}
}
async function showVersions(t:PrintTemplate){
  activeTemplate.value=t
  ;[versions.value,releases.value]=await Promise.all([listTemplateVersions(t.id),listTemplateReleases(t.id)])
  versionsOpen.value=true
}
async function showAudit(t:PrintTemplate){
  activeTemplate.value=t;audits.value=await listTemplateAudit(t.id);auditOpen.value=true
}
async function showValidation(t:PrintTemplate){
  activeTemplate.value=t;validation.value=await validateTemplate(t.id);validationOpen.value=true
}
function startRollback(versionNo:number){
  rollbackForm.versionNo=versionNo;rollbackForm.changeNote='回滚到 v'+versionNo;rollbackForm.scopeType='ALL';rollbackForm.scopeValues='';rollbackOpen.value=true
}
async function confirmRollback(){
  if(!activeTemplate.value)return
  try{
    const values=rollbackForm.scopeType==='ALL'?[]:rollbackForm.scopeValues.split(/[，,\n]/).map(v=>v.trim()).filter(Boolean)
    const updated=await rollbackTemplate(activeTemplate.value.id,rollbackForm.versionNo,rollbackForm.changeNote,{type:rollbackForm.scopeType,values})
    const index=templates.value.findIndex(t=>t.id===updated.id);if(index>=0)templates.value[index]=updated
    rollbackOpen.value=false;versionsOpen.value=false;message.success('已回滚并发布为新版本 v'+updated.publishedVersion)
  }catch(e:any){message.error(e?.response?.data?.detail||'回滚失败')}
}
function disable(t:PrintTemplate){
  Modal.confirm({
    title:'停用模板？',
    content:'停用后当前发布范围将全部失效，但历史版本和审计记录不会删除。',
    okType:'danger',
    async onOk(){
      try{const updated=await disableTemplate(t.id);const i=templates.value.findIndex(x=>x.id===t.id);if(i>=0)templates.value[i]=updated;message.success('模板已停用')}
      catch(e:any){message.error(e?.response?.data?.detail||'停用失败')}
    }
  })
}
onMounted(refreshAll)
</script>

<template>
<div>
  <div class="page-head">
    <div><span class="eyebrow">TEMPLATE PLATFORM</span><h1>模板中心</h1><p>管理本地模板生命周期，也可以从在线模板中心预览并安装 Print Platform Original 商用模板。</p></div>
    <a-space><a-button @click="refreshAll">刷新全部</a-button><a-button type="primary" @click="createOpen=true">＋ 新建本地模板</a-button></a-space>
  </div>

  <div class="metrics">
    <a-card><span>本地模板</span><strong>{{stats.total}}</strong><em>SQLite</em></a-card>
    <a-card><span>本地已发布</span><strong>{{stats.published}}</strong><em>可上传在线</em></a-card>
    <a-card><span>在线模板</span><strong>{{stats.cloud}}</strong><em>{{cloudStatus?.provider||'Cloud'}}</em></a-card>
    <a-card><span>在线状态</span><strong class="cloud-state">{{cloudStatus?.available?'可用':'未连接'}}</strong><em>{{cloudStatus?.message||'正在检测'}}</em></a-card>
  </div>

  <a-tabs v-model:active-key="storageTab" class="storage-tabs">
    <a-tab-pane key="local" tab="本地模板 · SQLite">
      <a-alert type="info" show-icon message="本地模板是唯一编辑源" description="草稿、测试、审核、发布、回滚和审计全部保存在本地 SQLite。上传在线时只上传当前不可变的已发布版本。"/>
      <a-card class="task-card storage-card">
        <a-table :data-source="templates" :loading="loading" row-key="id" :pagination="false" :scroll="{x:1250}">
          <a-table-column title="模板" :width="250"><template #default="{record}"><strong>{{record.name}}</strong><div class="table-sub">{{record.code}}</div></template></a-table-column>
          <a-table-column title="文档类型" :width="120"><template #default="{record}">{{docLabel(record.documentType)}}</template></a-table-column>
          <a-table-column title="状态" :width="100"><template #default="{record}"><a-tag :color="statusColor[record.status]">{{statusText[record.status]}}</a-tag></template></a-table-column>
          <a-table-column title="草稿修订" data-index="draftRevision" :width="90"/>
          <a-table-column title="发布版本" :width="90"><template #default="{record}">{{record.publishedVersion?'v'+record.publishedVersion:'—'}}</template></a-table-column>
          <a-table-column title="更新时间" :width="180"><template #default="{record}">{{new Date(record.updatedAt).toLocaleString()}}</template></a-table-column>
          <a-table-column title="操作" :width="500">
            <template #default="{record}">
              <a-space wrap>
                <a-button type="primary" size="small" @click="emit('edit',record)">设计</a-button>
                <a-button size="small" @click="clone(record)">复制</a-button>
                <a-button size="small" @click="showVersions(record)">版本 / 范围</a-button>
                <a-button size="small" @click="showValidation(record)">校验</a-button>
                <a-button size="small" @click="showAudit(record)">审计</a-button>
                <a-tooltip :title="record.status==='PUBLISHED'?(cloudStatus?.available?'上传当前发布版本到在线模板库':'在线模板库当前不可用'):'只有 PUBLISHED 模板可以上传'">
                  <a-button
                    size="small"
                    :loading="cloudActionKey==='upload:'+record.id"
                    :disabled="record.status!=='PUBLISHED'||!cloudStatus?.available||!cloudStatus?.publisherEnabled"
                    @click="uploadOnline(record)"
                  >上传在线</a-button>
                </a-tooltip>
                <a-button v-if="record.status!=='DISABLED'" size="small" danger @click="disable(record)">停用</a-button>
              </a-space>
            </template>
          </a-table-column>
        </a-table>
      </a-card>
    </a-tab-pane>

    <a-tab-pane key="cloud" tab="在线模板中心">
      <CloudTemplateMarket @changed="refreshAll"/>
    </a-tab-pane>
  </a-tabs>

  <a-modal v-model:open="createOpen" title="新建打印模板" @ok="create">
    <a-form layout="vertical">
      <a-form-item label="模板编码"><a-input v-model:value="form.code" placeholder="例如 outpatient-receipt"/></a-form-item>
      <a-form-item label="模板名称"><a-input v-model:value="form.name" placeholder="例如 门诊缴费票据"/></a-form-item>
      <a-form-item label="文档类型"><a-select v-model:value="form.documentType"><a-select-option value="FORM">普通表单</a-select-option><a-select-option value="INVOICE">发票</a-select-option><a-select-option value="RECEIPT">收据</a-select-option><a-select-option value="EXPENSE_LIST">费用清单</a-select-option><a-select-option value="POS_RECEIPT">小票</a-select-option><a-select-option value="LABEL">标签</a-select-option><a-select-option value="REPORT">多页报告</a-select-option></a-select></a-form-item>
    </a-form>
  </a-modal>

  <a-modal v-model:open="versionsOpen" :title="(activeTemplate?.name||'')+' · 版本与影响范围'" :footer="null" width="900px">
    <a-empty v-if="!versions.length" description="还没有发布版本"/>
    <a-table v-else :data-source="versions" row-key="id" :pagination="false" size="small">
      <a-table-column title="版本"><template #default="{record}"><strong>v{{record.versionNo}}</strong></template></a-table-column>
      <a-table-column title="发布时间"><template #default="{record}">{{new Date(record.createdAt).toLocaleString()}}</template></a-table-column>
      <a-table-column title="说明" data-index="changeNote"/>
      <a-table-column title="生效范围"><template #default="{record}"><a-tag :color="releaseForVersion(record.versionNo)?.active?'green':'default'">{{scopeLabel(releaseForVersion(record.versionNo))}}</a-tag><div v-if="releaseForVersion(record.versionNo)?.rollbackFromVersion" class="table-sub">回滚自 v{{releaseForVersion(record.versionNo)?.rollbackFromVersion}}</div></template></a-table-column>
      <a-table-column title="操作"><template #default="{record}"><a-button size="small" @click="startRollback(record.versionNo)">回滚到此版本</a-button></template></a-table-column>
    </a-table>
  </a-modal>

  <a-modal v-model:open="rollbackOpen" title="回滚并发布为新版本" @ok="confirmRollback">
    <a-alert type="info" show-icon :message="'历史 v'+rollbackForm.versionNo+' 不会被覆盖；系统会创建一个新的发布版本。'" style="margin-bottom:12px"/>
    <a-form layout="vertical">
      <a-form-item label="回滚说明"><a-textarea v-model:value="rollbackForm.changeNote" :rows="3"/></a-form-item>
      <a-form-item label="新版本生效范围"><a-select v-model:value="rollbackForm.scopeType"><a-select-option value="ALL">全部</a-select-option><a-select-option value="ORG">组织</a-select-option><a-select-option value="CAMPUS">院区</a-select-option><a-select-option value="DEPARTMENT">科室</a-select-option><a-select-option value="TERMINAL">终端</a-select-option></a-select></a-form-item>
      <a-form-item v-if="rollbackForm.scopeType!=='ALL'" label="范围值"><a-textarea v-model:value="rollbackForm.scopeValues" :rows="3" placeholder="逗号或换行分隔"/></a-form-item>
    </a-form>
  </a-modal>

  <a-modal v-model:open="auditOpen" :title="(activeTemplate?.name||'')+' · 审计记录'" :footer="null" width="850px">
    <a-timeline>
      <a-timeline-item v-for="item in audits" :key="item.id">
        <strong>{{item.action}}</strong> · {{new Date(item.createdAt).toLocaleString()}}
        <pre class="audit-json">{{JSON.stringify(item.detail,null,2)}}</pre>
      </a-timeline-item>
    </a-timeline>
  </a-modal>

  <a-modal v-model:open="validationOpen" :title="(activeTemplate?.name||'')+' · 模板校验'" :footer="null" width="720px">
    <a-result v-if="validation" :status="validation.valid?'success':'error'" :title="validation.valid?'校验通过':'存在阻断错误'"/>
    <a-alert v-for="item in validation?.errors||[]" :key="'e'+item" type="error" :message="item" show-icon style="margin-bottom:6px"/>
    <a-alert v-for="item in validation?.warnings||[]" :key="'w'+item" type="warning" :message="item" show-icon style="margin-bottom:6px"/>
  </a-modal>
</div>
</template>

<style scoped>
.audit-json{margin:5px 0 0;padding:7px;background:#f5f8fa;border-radius:6px;font-size:10px;white-space:pre-wrap;word-break:break-all}
.storage-tabs{margin-top:4px}.storage-card{margin-top:12px}.cloud-state{font-size:22px!important}.cloud-config{margin:9px 0 0;padding:10px;border-radius:8px;background:#f7fafc;white-space:pre-wrap;font-size:11px;line-height:1.6}
</style>