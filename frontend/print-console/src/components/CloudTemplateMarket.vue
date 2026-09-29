<script setup lang="ts">
import { computed,onMounted,ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  getCloudTemplate,getCloudTemplateStatus,installCloudTemplate,listCloudTemplates,listTemplateInstallations,refreshTemplateLicense
} from '../api'
import type {
  CloudTemplateBundle,CloudTemplateCatalogStatus,CloudTemplateCategory,CloudTemplateSummary,PrintTemplate,TemplateInstallation
} from '../types'
import CloudTemplateThumbnail from './CloudTemplateThumbnail.vue'
import PreviewModal from './PreviewModal.vue'

const emit=defineEmits<{(e:'changed'):void}>()

const loading=ref(false)
const actionKey=ref('')
const status=ref<CloudTemplateCatalogStatus|null>(null)
const items=ref<CloudTemplateSummary[]>([])
const bundles=ref<Record<string,CloudTemplateBundle>>({})
const installations=ref<TemplateInstallation[]>([])
const query=ref('')
const category=ref<'ALL'|CloudTemplateCategory>('ALL')
const access=ref<'ALL'|'FREE'|'SUBSCRIPTION'>('ALL')
const onlyFeatured=ref(false)
const previewOpen=ref(false)
const previewBundle=ref<CloudTemplateBundle|null>(null)

const categoryOptions:{key:'ALL'|CloudTemplateCategory;label:string}[]=[
  {key:'ALL',label:'全部'},
  {key:'FINANCE',label:'财务'},
  {key:'SALES',label:'销售'},
  {key:'PURCHASE',label:'采购'},
  {key:'WAREHOUSE',label:'仓储'},
  {key:'RETAIL',label:'零售'},
  {key:'MEDICAL',label:'医疗'},
  {key:'LOGISTICS',label:'物流'}
]
const categoryText:Record<string,string>={
  FINANCE:'财务',SALES:'销售',PURCHASE:'采购',WAREHOUSE:'仓储',RETAIL:'零售',MEDICAL:'医疗',LOGISTICS:'物流',OTHER:'其他'
}
const filtered=computed(()=>{
  const keyword=query.value.trim().toLowerCase()
  return items.value.filter(item=>{
    if(category.value!=='ALL'&&item.category!==category.value)return false
    if(access.value!=='ALL'&&item.accessModel!==access.value)return false
    if(onlyFeatured.value&&!item.featured)return false
    if(!keyword)return true
    const hay=[item.name,item.code,item.description,...(item.tags||[])].join(' ').toLowerCase()
    return hay.includes(keyword)
  })
})
const previewContext=computed(()=>({label:'在线模板 · '+(previewBundle.value?.accessModel==='FREE'?'FREE':'PRO')}))
const previewTemplate=computed<PrintTemplate|null>(()=>{
  const b=previewBundle.value
  if(!b)return null
  return {
    id:'CLOUD-PREVIEW-'+b.code,
    code:b.code,
    name:b.name,
    documentType:b.documentType,
    status:'PUBLISHED',
    draftRevision:0,
    publishedVersion:b.versionNo,
    design:b.design,
    sampleData:b.sampleData,
    dataConfig:b.dataConfig,
    createdAt:b.publishedAt,
    updatedAt:b.uploadedAt
  }
})

function installed(item:CloudTemplateSummary){
  return installations.value.find(i=>i.cloudTemplateCode===item.code)
}
function bundleKey(item:CloudTemplateSummary){return item.code+':'+item.versionNo}
function bundleOf(item:CloudTemplateSummary){return bundles.value[bundleKey(item)]}
function installLabel(item:CloudTemplateSummary){
  const current=installed(item)
  if(!current)return '安装到本地'
  return current.cloudVersion<item.versionNo?'升级到 v'+item.versionNo:'重新校验'
}
function accessLabel(item:CloudTemplateSummary){return item.accessModel==='FREE'?'FREE':'PRO'}

async function loadBundle(item:CloudTemplateSummary){
  const key=bundleKey(item)
  if(bundles.value[key])return bundles.value[key]
  const bundle=await getCloudTemplate(item.code,item.versionNo)
  bundles.value={...bundles.value,[key]:bundle}
  return bundle
}

async function refresh(){
  loading.value=true
  try{
    const [nextStatus,nextItems,nextInstallations]=await Promise.all([
      getCloudTemplateStatus(),listCloudTemplates(),listTemplateInstallations()
    ])
    status.value=nextStatus
    items.value=nextItems
    installations.value=nextInstallations

    const curated=nextItems.slice(0,36)
    const loaded=await Promise.all(curated.map(async item=>{
      try{return [bundleKey(item),await getCloudTemplate(item.code,item.versionNo)] as const}
      catch{return null}
    }))
    const next:Record<string,CloudTemplateBundle>={}
    loaded.forEach(entry=>{if(entry)next[entry[0]]=entry[1]})
    bundles.value=next
  }catch(e:any){
    message.error(e?.response?.data?.detail||'在线模板中心加载失败')
  }finally{loading.value=false}
}

async function preview(item:CloudTemplateSummary){
  actionKey.value='preview:'+item.code
  try{
    previewBundle.value=await loadBundle(item)
    previewOpen.value=true
  }catch(e:any){message.error(e?.response?.data?.detail||'在线模板预览失败')}
  finally{actionKey.value=''}
}

async function install(item:CloudTemplateSummary){
  if(item.accessModel==='SUBSCRIPTION'&&!item.entitled){
    message.warning('这是 PRO 模板。当前账号暂无有效订阅授权，可以先预览。')
    return
  }
  actionKey.value='install:'+item.code
  try{
    const result=await installCloudTemplate(item.code,item.versionNo)
    const index=installations.value.findIndex(i=>i.cloudTemplateCode===item.code)
    if(index>=0)installations.value[index]=result.installation
    else installations.value.unshift(result.installation)
    message.success('已安装到本地模板：'+result.template.name)
    emit('changed')
  }catch(e:any){message.error(e?.response?.data?.detail||'在线模板安装失败')}
  finally{actionKey.value=''}
}

async function refreshLicense(item:CloudTemplateSummary){
  const current=installed(item)
  if(!current)return
  actionKey.value='license:'+item.code
  try{
    const updated=await refreshTemplateLicense(current.localTemplateId)
    const index=installations.value.findIndex(i=>i.localTemplateId===updated.localTemplateId)
    if(index>=0)installations.value[index]=updated
    message.success('授权状态已刷新')
  }catch(e:any){message.error(e?.response?.data?.detail||'授权刷新失败')}
  finally{actionKey.value=''}
}

onMounted(refresh)
</script>

<template>
  <section class="market">
    <div class="market-hero">
      <div>
        <span class="market-eyebrow">PRINT PLATFORM ORIGINALS</span>
        <h2>在线模板中心</h2>
        <p>12 张原创商用模板，覆盖财务、销售、采购、仓储、零售、医疗和物流。FREE 可直接安装，PRO 可先完整预览。</p>
      </div>
      <div class="hero-stat">
        <strong>{{items.length}}</strong>
        <span>在线模板</span>
      </div>
    </div>

    <a-alert
      v-if="status"
      :type="status.available?'success':'warning'"
      show-icon
      :message="status.message"
      class="market-status"
    />

    <div class="market-controls">
      <a-input-search v-model:value="query" allow-clear placeholder="搜索模板名称、场景、标签…" class="market-search"/>
      <a-segmented v-model:value="access" :options="[{label:'全部权益',value:'ALL'},{label:'FREE',value:'FREE'},{label:'PRO',value:'SUBSCRIPTION'}]"/>
      <a-checkbox v-model:checked="onlyFeatured">只看推荐</a-checkbox>
      <a-button :loading="loading" @click="refresh">刷新</a-button>
    </div>

    <div class="category-row">
      <button
        v-for="option in categoryOptions"
        :key="option.key"
        class="category-chip"
        :class="{active:category===option.key}"
        @click="category=option.key"
      >{{option.label}}</button>
    </div>

    <div class="result-line">
      <span>共 {{filtered.length}} 张</span>
      <span v-if="query">搜索 “{{query}}”</span>
    </div>

    <a-spin :spinning="loading">
      <div v-if="filtered.length" class="template-grid">
        <article v-for="item in filtered" :key="item.code" class="template-card">
          <div class="thumb-wrap">
            <CloudTemplateThumbnail
              :design="bundleOf(item)?.design"
              :style-key="item.thumbnailStyle"
              :title="item.name"
            />
            <div class="badge-row">
              <span class="access-badge" :class="{pro:item.accessModel==='SUBSCRIPTION'}">{{accessLabel(item)}}</span>
              <span v-if="item.featured" class="featured-badge">推荐</span>
            </div>
            <span v-if="installed(item)" class="installed-badge">已安装 v{{installed(item)?.cloudVersion}}</span>
          </div>

          <div class="card-body">
            <div class="title-row">
              <div>
                <h3>{{item.name}}</h3>
                <span>{{categoryText[item.category]||item.category}} · {{item.paperLabel}}</span>
              </div>
              <a-tag color="blue">v{{item.versionNo}}</a-tag>
            </div>
            <p>{{item.description}}</p>
            <div class="tags">
              <span v-for="tag in item.tags.slice(0,4)" :key="tag">{{tag}}</span>
            </div>

            <div v-if="item.accessModel==='SUBSCRIPTION'" class="pro-line">
              <span>{{item.entitled?'PRO 已授权':'PRO 订阅模板'}}</span>
              <small v-if="item.productCode">{{item.productCode}}<template v-if="item.planCode"> · {{item.planCode}}</template></small>
            </div>

            <div class="card-actions">
              <a-button :loading="actionKey==='preview:'+item.code" @click="preview(item)">在线预览</a-button>
              <a-button
                type="primary"
                :loading="actionKey==='install:'+item.code"
                :disabled="item.accessModel==='SUBSCRIPTION'&&!item.entitled"
                @click="install(item)"
              >{{item.accessModel==='SUBSCRIPTION'&&!item.entitled?'PRO 未授权':installLabel(item)}}</a-button>
              <a-button
                v-if="installed(item)?.origin==='CLOUD_SUBSCRIPTION'"
                :loading="actionKey==='license:'+item.code"
                @click="refreshLicense(item)"
              >刷新授权</a-button>
            </div>
          </div>
        </article>
      </div>
      <a-empty v-else description="没有符合条件的在线模板"/>
    </a-spin>

    <PreviewModal
      v-if="previewTemplate"
      v-model:open="previewOpen"
      :template="previewTemplate"
      :render-data="previewBundle?.sampleData"
      :context="previewContext"
    />
  </section>
</template>

<style scoped>
.market{display:grid;gap:16px}
.market-hero{
  display:flex;align-items:flex-end;justify-content:space-between;gap:24px;
  padding:24px 26px;border-radius:16px;
  background:linear-gradient(135deg,#0d2235,#183e5a 55%,#315b76);color:#fff
}
.market-eyebrow{font-size:10px;letter-spacing:.16em;color:#91b8d0;font-weight:700}
.market-hero h2{margin:7px 0 5px;font-size:26px;color:#fff}
.market-hero p{margin:0;max-width:720px;color:#bed1de;line-height:1.7;font-size:13px}
.hero-stat{display:grid;min-width:90px;text-align:right}.hero-stat strong{font-size:34px;line-height:1}.hero-stat span{margin-top:5px;color:#a9c2d1;font-size:11px}
.market-status{border-radius:12px}
.market-controls{display:flex;align-items:center;gap:10px;padding:13px;border:1px solid #e0e7ed;border-radius:12px;background:#fff}
.market-search{max-width:420px}
.category-row{display:flex;gap:8px;flex-wrap:wrap}
.category-chip{
  border:1px solid #d6e0e8;background:#fff;color:#526879;border-radius:999px;padding:7px 13px;font-size:12px
}
.category-chip:hover{border-color:#8eabbf;color:#2f617f}
.category-chip.active{background:#163c57;border-color:#163c57;color:#fff}
.result-line{display:flex;gap:12px;color:#7a8b98;font-size:11px}
.template-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.template-card{
  min-width:0;overflow:hidden;border:1px solid #dce5eb;border-radius:16px;background:#fff;
  transition:.18s ease;box-shadow:0 4px 14px rgba(32,53,70,.03)
}
.template-card:hover{transform:translateY(-2px);border-color:#b4c7d4;box-shadow:0 12px 28px rgba(33,56,73,.08)}
.thumb-wrap{position:relative;padding:10px 10px 0}
.badge-row{position:absolute;left:22px;top:22px;display:flex;gap:6px}
.access-badge,.featured-badge,.installed-badge{
  padding:4px 7px;border-radius:999px;font-size:9px;font-weight:800;letter-spacing:.04em;box-shadow:0 2px 6px rgba(0,0,0,.08)
}
.access-badge{background:#eaf7ef;color:#24704a}.access-badge.pro{background:#302748;color:#fff}
.featured-badge{background:#fff2c9;color:#8a6500}
.installed-badge{position:absolute;right:22px;top:22px;background:#e9f2fb;color:#2d668f}
.card-body{display:grid;gap:10px;padding:15px 16px 16px}
.title-row{display:flex;justify-content:space-between;gap:10px}
.title-row h3{margin:0 0 3px;font-size:15px;color:#1d3042}
.title-row span{font-size:10px;color:#8595a1}
.card-body p{margin:0;min-height:42px;color:#607482;font-size:11px;line-height:1.65}
.tags{display:flex;gap:5px;flex-wrap:wrap}.tags span{padding:3px 6px;border-radius:5px;background:#f1f5f7;color:#637886;font-size:9px}
.pro-line{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;border-radius:8px;background:#f6f2fb;color:#5e4672;font-size:10px}.pro-line small{color:#8f7a9e}
.card-actions{display:flex;gap:7px;flex-wrap:wrap;padding-top:2px}
@media(max-width:1400px){.template-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
