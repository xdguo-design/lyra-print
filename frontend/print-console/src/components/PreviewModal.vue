<script setup lang="ts">
import { computed,nextTick,ref,watch } from 'vue'
import type { CSSProperties } from 'vue'
import type { PrintTemplate,TemplateElement,TemplateTestTarget } from '../types'
import { adaptiveReceiptLayout,paginateRows,tableRows } from '../designer/model'
import { buildPrintDocument,openPrintDocument,parsePageRange } from '../print/print-document'
import ElementRenderer from './ElementRenderer.vue'
import { printViaExtension } from '../print/extension-bridge'

const props=defineProps<{
  open:boolean
  template:PrintTemplate
  showReference?:boolean
  renderData?:Record<string,unknown>|null
  context?:{label:string;target?:TemplateTestTarget|null;testRunId?:string|null}|null
  pluginPrint?:{testRunId:string;printerId:string}|null
  productionPrint?:{
    taskId:string;printerId:string;copies:number;prepare:()=>Promise<void>;
    calibration?:{offsetXmm:number;offsetYmm:number;scalePercent:number};
    printOptions?:{duplexMode:string;colorMode:string;fitMode:string;paperSource?:string}
  }|null
}>()
const emit=defineEmits<{
  (e:'update:open',value:boolean):void
  (e:'rendered',value:{pageCount:number;elapsedMs:number}):void
  (e:'plugin-result',value:{success:boolean;agentJobId?:string;elapsedMs:number;message?:string}):void
  (e:'production-result',value:{success:boolean;executed:boolean;agentJobId?:string;elapsedMs:number;message?:string}):void
}>()
const pluginBusy=ref(false)
const pageRange=ref('')
const pageRangeError=ref('')

const data=computed(()=>props.renderData??props.template.sampleData)
const paper=computed(()=>props.template.design.paper)
const adaptiveLayout=computed(()=>paper.value.autoHeight
  ?adaptiveReceiptLayout(
    props.template.design.elements,
    data.value,
    paper.value.marginBottom,
    paper.value.autoHeightMaxMm||1000
  )
  :null
)
const pageSize=computed(()=>{
  const p=paper.value
  if(p.autoHeight)return {width:p.width,height:adaptiveLayout.value?.height||p.height}
  const landscape=p.orientation==='LANDSCAPE'
  return {width:landscape?p.height:p.width,height:landscape?p.width:p.height}
})
const pageCount=computed(()=>{
  if(paper.value.autoHeight)return 1
  let count=1
  for(const el of props.template.design.elements){
    if(el.type!=='TABLE'||!el.table)continue
    count=Math.max(count,paginateRows(tableRows(el,data.value),el.table).length)
  }
  return count
})
const pages=computed(()=>Array.from({length:pageCount.value},(_,i)=>i))
const elements=computed(()=>{
  const source=adaptiveLayout.value?.elements||props.template.design.elements
  return [...source].filter(e=>e.visible).sort((a,b)=>a.zIndex-b.zIndex)
})

function shouldRender(el:TemplateElement,pageIndex:number){
  if(['HEADER','FOOTER','WATERMARK','PAGE','TABLE'].includes(el.type))return true
  return pageIndex===0
}
function rowsFor(el:TemplateElement,pageIndex:number){
  if(el.type!=='TABLE'||!el.table)return undefined
  if(paper.value.autoHeight)return tableRows(el,data.value)
  return paginateRows(tableRows(el,data.value),el.table)[pageIndex]||[]
}
function showHeader(el:TemplateElement,pageIndex:number){
  if(el.type!=='TABLE'||!el.table)return true
  return pageIndex===0||el.table.repeatHeader
}
function elementStyle(el:TemplateElement):CSSProperties{
  const s=el.style||{} as any
  const justify=s.textAlign==='center'?'center':s.textAlign==='right'?'flex-end':'flex-start'
  const align=s.verticalAlign==='top'?'flex-start':s.verticalAlign==='bottom'?'flex-end':'center'
  return {
    position:'absolute',left:el.x+'mm',top:el.y+'mm',width:el.w+'mm',height:el.h+'mm',
    display:el.visible?'flex':'none',alignItems:align,justifyContent:justify,
    fontFamily:s.fontFamily,fontSize:el.fontSize+'pt',fontWeight:s.fontWeight,fontStyle:s.fontStyle,
    textDecoration:s.textDecoration,color:s.color,background:s.background,
    border:(s.borderWidth||0)+'px solid '+(s.borderColor||'transparent'),
    opacity:String(s.opacity??1),transform:'rotate('+(s.rotation||0)+'deg)',
    transformOrigin:'center center',overflow:'hidden',
    zIndex:String(el.zIndex),whiteSpace:'pre-wrap',textAlign:s.textAlign as any,
    borderTop:el.type==='LINE'?'1px solid '+(s.borderColor||'#17365f'):undefined
  }
}
function pageStyle():CSSProperties{return {width:pageSize.value.width+'mm',height:pageSize.value.height+'mm'}}
function targetLabel(target?:TemplateTestTarget|null){
  if(!target)return ''
  return target.kind==='VERSION'?'发布版本 v'+target.versionNo:'草稿修订 r'+target.draftRevision
}
function referenceStyle(){
  const ref=props.template.design.referenceImage
  return ref?{backgroundImage:'url("'+ref.correctedDataUrl+'")',backgroundSize:'100% 100%',opacity:String(ref.opacity)}:{}
}
function selectedPagesHtml(source:Element){
  pageRangeError.value=''
  try{
    const selected=parsePageRange(pageRange.value,pageCount.value)
    if(selected.length===pageCount.value)return source.innerHTML
    const clone=source.cloneNode(true) as HTMLElement
    Array.from(clone.querySelectorAll('.print-page')).forEach((page,index)=>{
      if(!selected.includes(index+1))page.remove()
    })
    return clone.innerHTML
  }catch(e:any){
    pageRangeError.value=e?.message||'页范围无效'
    throw e
  }
}
function printOrPdf(){
  const source=document.querySelector('.print-pages')
  if(!source)return
  try{
    const html=selectedPagesHtml(source)
    openPrintDocument(props.template.name,html,undefined,undefined,pageSize.value)
  }catch{}
}
function exportHtml(){
  const source=document.querySelector('.print-pages')
  if(!source)return
  const html=buildPrintDocument(props.template.name,source.innerHTML,pageSize.value)
  const blob=new Blob([html],{type:'text/html;charset=utf-8'})
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=props.template.code+'.print.html';a.click();URL.revokeObjectURL(a.href)
}

async function waitPaint(){
  await nextTick()
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
}
watch(()=>props.open,async open=>{
  if(!open)return
  const started=performance.now()
  await waitPaint()
  emit('rendered',{pageCount:pageCount.value,elapsedMs:Math.max(0,Math.round(performance.now()-started))})
})
async function localPrintDocument(){
  if(!props.pluginPrint&&!props.productionPrint)return
  const source=document.querySelector('.print-pages')
  if(!source)return
  pluginBusy.value=true
  const started=performance.now()
  try{
    if(props.productionPrint)await props.productionPrint.prepare()
    const html=buildPrintDocument(
      props.template.name,
      props.productionPrint?source.innerHTML:selectedPagesHtml(source),
      pageSize.value,
      props.productionPrint?.calibration
    )
    const job=await printViaExtension({
      testRunId:props.pluginPrint?.testRunId,
      taskId:props.productionPrint?.taskId,
      printerId:props.productionPrint?.printerId||props.pluginPrint?.printerId||'',
      title:props.template.name,
      documentHtml:html,
      pageSize:pageSize.value,
      mode:props.productionPrint?'PRODUCTION':'TEST',
      copies:props.productionPrint?.copies??1,
      printOptions:props.productionPrint?.printOptions
    })
    const elapsedMs=Math.max(0,Math.round(performance.now()-started))
    if(props.productionPrint){
      emit('production-result',{
        success:job.accepted===true&&job.executed===true,
        executed:job.executed===true,
        agentJobId:job.jobId,
        elapsedMs,
        message:job.note||(job.executed?'Agent 已执行正式打印':'Agent 未执行物理打印')
      })
    }else{
      emit('plugin-result',{
        success:job.accepted===true,
        agentJobId:job.jobId,
        elapsedMs,
        message:job.note||'Agent 已接收打印任务'
      })
    }
  }catch(e:any){
    const result={success:false,executed:false,elapsedMs:Math.max(0,Math.round(performance.now()-started)),message:e?.message||'本地打印失败'}
    if(props.productionPrint)emit('production-result',result)
    else emit('plugin-result',result)
  }finally{pluginBusy.value=false}
}
</script>

<template>
<a-modal :open="open" width="1120px" :footer="null" title="分页预览 / 打印 / 保存 PDF" @cancel="emit('update:open',false)">
  <div class="preview-toolbar">
    <div>
      <div class="preview-title-line">
        <strong>{{template.name}}</strong>
        <a-tag :color="renderData?'blue':'default'">{{context?.label||'样例数据'}}</a-tag>
        <a-tag v-if="context?.target" color="cyan">{{targetLabel(context.target)}}</a-tag>
      </div>
      <span>{{pageCount}} 页 · {{pageSize.width}} × {{Math.round(pageSize.height*10)/10}} mm · {{paper.autoHeight?'自适应高度':paper.orientation==='LANDSCAPE'?'横向':'纵向'}}<template v-if="productionPrint?.calibration"> · 校准 X {{productionPrint.calibration.offsetXmm}}mm / Y {{productionPrint.calibration.offsetYmm}}mm / {{productionPrint.calibration.scalePercent}}%</template><template v-if="productionPrint?.printOptions"> · {{productionPrint.printOptions.duplexMode}} / {{productionPrint.printOptions.colorMode}} / {{productionPrint.printOptions.fitMode}}</template><template v-if="context?.testRunId"> · {{context.testRunId}}</template></span>
    </div>
    <a-space>
      <a-tooltip :title="productionPrint?'正式任务固定整份打印；页范围仅用于预览、浏览器打印和测试打印':''">
        <a-input
          v-model:value="pageRange"
          :disabled="!!productionPrint"
          placeholder="页范围：1-3,5"
          style="width:145px"
          allow-clear
        />
      </a-tooltip>
      <a-button @click="exportHtml">导出 HTML</a-button>
      <a-button v-if="pluginPrint||productionPrint" :loading="pluginBusy" type="primary" @click="localPrintDocument">
        {{productionPrint?'执行正式打印':'发送到本地打印插件'}}
      </a-button>
      <a-button :type="pluginPrint||productionPrint?'default':'primary'" @click="printOrPdf">打印 / 保存为 PDF</a-button>
    </a-space>
  </div>
  <a-alert v-if="pageRangeError" type="error" show-icon :message="pageRangeError" style="margin-bottom:10px"/>
  <a-alert
    show-icon
    :type="productionPrint?'warning':'info'"
    :message="productionPrint?'当前是正式打印：将使用任务创建时冻结的模板版本和 renderData。只有 Agent 明确返回 executed=true 才会把任务记为 SUCCESS。':pluginPrint?'当前是插件打印测试：页面先生成完整 HTML，再通过扩展发送给本地 Agent；测试接收不代表物理打印成功。':'打印与 PDF 使用同一份分页渲染结果；选择“打印 / 保存为 PDF”后，可在浏览器打印对话框中选择打印机或“另存为 PDF”。'"
    style="margin-bottom:10px"
  />
  <div class="preview-scroll">
    <div class="print-pages">
      <div v-for="pageIndex in pages" :key="pageIndex" class="print-page" :data-page="pageIndex+1" :style="pageStyle()">
        <div v-if="showReference&&template.design.referenceImage" class="preview-reference" :style="referenceStyle()"></div>
        <template v-for="el in elements" :key="el.id">
          <div v-if="shouldRender(el,pageIndex)" class="preview-element" :style="elementStyle(el)">
            <ElementRenderer
              :element="el"
              :data="data"
              :rows-override="rowsFor(el,pageIndex)"
              :page="pageIndex+1"
              :pages="pageCount"
              :show-table-total="pageIndex===pageCount-1"
              :show-table-header="showHeader(el,pageIndex)"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</a-modal>
</template>

<style scoped>
.preview-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.preview-toolbar strong{display:block}.preview-toolbar span{display:block;color:#8295a5;font-size:12px}.preview-title-line{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.preview-scroll{max-height:72vh;overflow:auto;background:#dfe8ee;padding:20px}.print-pages{display:grid;gap:18px;justify-content:center}.print-page{position:relative;background:#fff;box-shadow:0 8px 28px rgba(40,70,95,.2);overflow:hidden}.preview-element{box-sizing:border-box}.preview-reference{position:absolute;inset:0;background-repeat:no-repeat;pointer-events:none;z-index:0}
</style>