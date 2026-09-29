<script setup lang="ts">
import { computed,onMounted,onUnmounted,reactive,ref,toRaw,watch } from 'vue'
import { message,Modal } from 'ant-design-vue'
import {
  listConnections,markTemplateTesting,preparePluginPrint,prepareSimulatedPrint,prepareTemplateTestData,
  publishTemplate,reportTemplatePrintResult,reportTemplateRenderResult,saveTemplateDraft,submitTemplateReview,
  testTemplateQuery,validateTemplate
} from '../api'
import type {
  AiCandidate,AiLayoutResponse,DataSourceConnection,PrintTemplate,QueryTestResponse,ReleaseScope,ReleaseScopeType,
  TemplateDataConfig,TemplateDesign,TemplateElement,TemplateElementType,TemplateTestTarget,TemplateValidationResult
} from '../types'
import { createElement,normalizeDesign } from '../designer/model'
import ElementRenderer from './ElementRenderer.vue'
import TableDesigner from './TableDesigner.vue'
import ReferenceImagePanel from './ReferenceImagePanel.vue'
import PreviewModal from './PreviewModal.vue'
import TemplateDataPanel from './TemplateDataPanel.vue'
import { apiProblem } from '../template-data-ui'
import type { UiProblem } from '../template-data-ui'
import './TemplateStudio.css'

const props=defineProps<{template:PrintTemplate}>()
const emit=defineEmits<{(e:'saved',value:PrintTemplate):void;(e:'back'):void}>()

const defaultDataConfig=():TemplateDataConfig=>({schemaVersion:1,mode:'JSON',queries:[]})
const model=reactive<{name:string;design:TemplateDesign;sampleData:Record<string,unknown>;dataConfig:TemplateDataConfig}>({
  name:props.template.name,
  design:normalizeDesign(props.template.design),
  sampleData:structuredClone(toRaw(props.template.sampleData)),
  dataConfig:structuredClone(toRaw(props.template.dataConfig||defaultDataConfig()))
})
const selectedId=ref<string|null>(model.design.elements[0]?.id||null)
const previewOpen=ref(false)
const runtimeRenderData=ref<Record<string,unknown>|null>(null)
const connections=ref<DataSourceConnection[]>([])
const testBusy=ref(false)
const activeTestRunId=ref<string|null>(null)
const activeTestType=ref<'PREVIEW'|'SIMULATED_PRINT'|'PLUGIN_PRINT'|null>(null)
const activePrinterId=ref('')
const queryResult=ref<QueryTestResponse|null>(null)
const testError=ref<UiProblem|null>(null)
const testContext=ref<{label:string;target?:TemplateTestTarget|null;testRunId?:string|null}|null>(null)
const connectionsError=ref('')
type LastTestAction=
  | {kind:'QUERY';queryId:string;params:Record<string,unknown>}
  | {kind:'PREVIEW'|'SIMULATED_PRINT';params:Record<string,unknown>}
  | {kind:'PLUGIN_PRINT';params:Record<string,unknown>;printerId:string}
const lastTestAction=ref<LastTestAction|null>(null)
const sampleOpen=ref(false)
const publishOpen=ref(false)
const validationOpen=ref(false)
const validation=ref<TemplateValidationResult|null>(null)
const history=ref<string[]>([])
const future=ref<string[]>([])
const canvasRef=ref<HTMLElement|null>(null)
const importing=ref<HTMLInputElement|null>(null)
const imageInput=ref<HTMLInputElement|null>(null)
const sampleText=ref(JSON.stringify(model.sampleData,null,2))
const snapGuideX=ref<number|null>(null)
const snapGuideY=ref<number|null>(null)
const saving=ref(false)
const publishing=ref(false)
const release=reactive<{changeNote:string;scopeType:ReleaseScopeType;scopeValues:string}>({
  changeNote:'',scopeType:'ALL',scopeValues:''
})
function serializeEditorState(){
  return JSON.stringify({name:model.name,design:model.design,sampleData:model.sampleData,dataConfig:model.dataConfig})
}
const savedEditorHash=ref(serializeEditorState())
const runtimeEditorHash=ref<string|null>(null)
const dirty=computed(()=>serializeEditorState()!==savedEditorHash.value)
const templateDisabled=computed(()=>props.template.status==='DISABLED')
let dragState:{id:string;startX:number;startY:number;x:number;y:number;mode:'move'|'resize';w:number;h:number}|null=null

watch(()=>props.template.id,resetFromProps)
function resetFromProps(){
  model.name=props.template.name
  model.design=normalizeDesign(props.template.design)
  model.sampleData=structuredClone(toRaw(props.template.sampleData))
  model.dataConfig=structuredClone(toRaw(props.template.dataConfig||defaultDataConfig()))
  runtimeRenderData.value=null
  runtimeEditorHash.value=null
  activeTestRunId.value=null
  activeTestType.value=null
  activePrinterId.value=''
  testContext.value=null
  testError.value=null
  queryResult.value=null
  validation.value=null
  sampleText.value=JSON.stringify(model.sampleData,null,2)
  selectedId.value=model.design.elements[0]?.id||null
  history.value=[];future.value=[]
  savedEditorHash.value=serializeEditorState()
}
const selected=computed(()=>model.design.elements.find(e=>e.id===selectedId.value)||null)
const sortedElements=computed(()=>[...model.design.elements].sort((a,b)=>a.zIndex-b.zIndex))
const previewTemplate=computed<PrintTemplate>(()=>({...props.template,name:model.name,design:model.design,sampleData:model.sampleData,dataConfig:model.dataConfig}))
const paperSize=computed(()=>{
  const p=model.design.paper
  return p.orientation==='LANDSCAPE'?{width:p.height,height:p.width}:{width:p.width,height:p.height}
})
const canvasStyle=computed(()=>({
  width:(paperSize.value.width*3)+'px',
  height:(paperSize.value.height*3)+'px',
  backgroundSize:model.design.grid?'15px 15px':'auto',
  backgroundImage:model.design.grid?'linear-gradient(#eaf0f5 1px,transparent 1px),linear-gradient(90deg,#eaf0f5 1px,transparent 1px)':'none'
}))
const palette:{type:TemplateElementType;label:string;icon:string}[]=[
  {type:'TEXT',label:'文本',icon:'T'},{type:'LONG_TEXT',label:'长文本',icon:'¶'},{type:'TITLE',label:'标题',icon:'H'},
  {type:'IMAGE',label:'图片',icon:'▧'},{type:'LINE',label:'线条',icon:'╱'},{type:'RECT',label:'矩形',icon:'□'},
  {type:'TABLE',label:'动态表格',icon:'▦'},{type:'BARCODE',label:'条码',icon:'▥'},{type:'QRCODE',label:'二维码',icon:'▣'},
  {type:'DATE',label:'日期',icon:'◷'},{type:'PAGE',label:'页码',icon:'#'},{type:'AMOUNT',label:'金额',icon:'￥'},
  {type:'HEADER',label:'页眉',icon:'↟'},{type:'FOOTER',label:'页脚',icon:'↡'},{type:'WATERMARK',label:'水印',icon:'◇'}
]

function editorState(){return {name:model.name,design:model.design,sampleData:model.sampleData,dataConfig:model.dataConfig}}
function restoreEditorState(raw:string){
  const state=JSON.parse(raw)
  model.name=state.name
  model.design=normalizeDesign(state.design)
  model.sampleData=state.sampleData
  model.dataConfig=state.dataConfig||defaultDataConfig()
  sampleText.value=JSON.stringify(model.sampleData,null,2)
  if(selectedId.value&&!model.design.elements.some(e=>e.id===selectedId.value))selectedId.value=model.design.elements[0]?.id||null
}
function snapshot(){
  const current=JSON.stringify(editorState())
  if(history.value.at(-1)===current)return
  history.value.push(current)
  if(history.value.length>80)history.value.shift()
  future.value=[]
}
function undo(){const v=history.value.pop();if(!v)return;future.value.push(JSON.stringify(editorState()));restoreEditorState(v)}
function redo(){const v=future.value.pop();if(!v)return;history.value.push(JSON.stringify(editorState()));restoreEditorState(v)}
function addElement(type:TemplateElementType,x=20,y=20){
  snapshot()
  const el=createElement(type,model.design.elements.length+1,x,y)
  model.design.elements.push(el);selectedId.value=el.id
}
function deleteSelected(){if(!selected.value)return;snapshot();model.design.elements=model.design.elements.filter(e=>e.id!==selectedId.value);selectedId.value=null}
function duplicateSelected(){
  const s=selected.value;if(!s)return
  snapshot()
  const copy=structuredClone(toRaw(s) as typeof s);copy.id='el-'+Date.now();copy.x=s.x+5;copy.y=s.y+5;copy.zIndex=Math.max(...model.design.elements.map(e=>e.zIndex),0)+1
  model.design.elements.push(copy);selectedId.value=copy.id
}
function moveLayer(delta:number){const s=selected.value;if(!s)return;snapshot();s.zIndex=Math.max(1,s.zIndex+delta)}
function snapValue(v:number){return model.design.snap?Math.round(v/5)*5:Math.round(v*10)/10}
function smartSnap(el:TemplateElement,nx:number,ny:number){
  snapGuideX.value=null;snapGuideY.value=null
  if(!model.design.snap)return {x:nx,y:ny}
  const threshold=2.2
  for(const other of model.design.elements){
    if(other.id===el.id||!other.visible)continue
    const xs=[other.x,other.x+other.w/2,other.x+other.w]
    const ys=[other.y,other.y+other.h/2,other.y+other.h]
    const myXs=[nx,nx+el.w/2,nx+el.w]
    const myYs=[ny,ny+el.h/2,ny+el.h]
    for(const ox of xs)for(let i=0;i<myXs.length;i++)if(Math.abs(myXs[i]-ox)<threshold){nx+=ox-myXs[i];snapGuideX.value=ox;break}
    for(const oy of ys)for(let i=0;i<myYs.length;i++)if(Math.abs(myYs[i]-oy)<threshold){ny+=oy-myYs[i];snapGuideY.value=oy;break}
  }
  return {x:snapValue(nx),y:snapValue(ny)}
}
function pointerDown(e:PointerEvent,el:TemplateElement,mode:'move'|'resize'){
  if(el.locked)return
  e.preventDefault();selectedId.value=el.id;snapshot()
  dragState={id:el.id,startX:e.clientX,startY:e.clientY,x:el.x,y:el.y,mode,w:el.w,h:el.h}
  window.addEventListener('pointermove',pointerMove);window.addEventListener('pointerup',pointerUp,{once:true})
}
function pointerMove(e:PointerEvent){
  if(!dragState)return
  const el=model.design.elements.find(v=>v.id===dragState!.id);if(!el)return
  const dx=(e.clientX-dragState.startX)/3,dy=(e.clientY-dragState.startY)/3
  if(dragState.mode==='move'){
    const pos=smartSnap(el,dragState.x+dx,dragState.y+dy)
    el.x=Math.max(0,Math.min(paperSize.value.width-el.w,pos.x))
    el.y=Math.max(0,Math.min(paperSize.value.height-el.h,pos.y))
  }else{
    el.w=Math.max(2,snapValue(dragState.w+dx));el.h=Math.max(2,snapValue(dragState.h+dy))
  }
}
function pointerUp(){dragState=null;snapGuideX.value=null;snapGuideY.value=null;window.removeEventListener('pointermove',pointerMove)}
function dragStart(e:DragEvent,type:TemplateElementType){e.dataTransfer?.setData('component',type)}
function dropCanvas(e:DragEvent){
  e.preventDefault();const type=e.dataTransfer?.getData('component') as TemplateElementType;if(!type)return
  const rect=canvasRef.value?.getBoundingClientRect();addElement(type,rect?Math.max(0,(e.clientX-rect.left)/3):20,rect?Math.max(0,(e.clientY-rect.top)/3):20)
}
function alignSelected(mode:'left'|'center'|'right'|'top'|'middle'|'bottom'){
  const el=selected.value;if(!el)return;snapshot()
  const p=model.design.paper,w=paperSize.value.width,h=paperSize.value.height
  if(mode==='left')el.x=p.marginLeft
  if(mode==='center')el.x=Math.max(p.marginLeft,(w-el.w)/2)
  if(mode==='right')el.x=Math.max(p.marginLeft,w-p.marginRight-el.w)
  if(mode==='top')el.y=p.marginTop
  if(mode==='middle')el.y=Math.max(p.marginTop,(h-el.h)/2)
  if(mode==='bottom')el.y=Math.max(p.marginTop,h-p.marginBottom-el.h)
}
function elementStyle(el:TemplateElement){
  const s=el.style
  return {
    left:(el.x*3)+'px',top:(el.y*3)+'px',width:(el.w*3)+'px',height:(el.h*3)+'px',
    fontSize:el.fontSize+'px',zIndex:el.zIndex,display:el.visible?'flex':'none',
    fontFamily:s.fontFamily,fontWeight:s.fontWeight,fontStyle:s.fontStyle,textDecoration:s.textDecoration,
    color:s.color,background:s.background,border:(s.borderWidth||0)+'px solid '+s.borderColor,
    opacity:String(s.opacity),transform:'rotate('+s.rotation+'deg)',
    justifyContent:s.textAlign==='center'?'center':s.textAlign==='right'?'flex-end':'flex-start',
    alignItems:s.verticalAlign==='top'?'flex-start':s.verticalAlign==='bottom'?'flex-end':'center',
    textAlign:s.textAlign as any,
    borderTop:el.type==='LINE'?'1px solid '+s.borderColor:undefined
  }
}
function paperPreset(size:string){
  snapshot()
  if(size==='A4')Object.assign(model.design.paper,{size:'A4',width:210,height:297,autoHeight:false})
  if(size==='A5')Object.assign(model.design.paper,{size:'A5',width:148,height:210,autoHeight:false})
  if(size==='80MM')Object.assign(model.design.paper,{size:'80MM',width:80,height:200,autoHeight:true,autoHeightMaxMm:1000,orientation:'PORTRAIT'})
  if(size==='LABEL')Object.assign(model.design.paper,{size:'LABEL',width:100,height:60,autoHeight:false})
}
function updateStyle(key:string,value:unknown){if(!selected.value)return;snapshot();(selected.value.style as any)[key]=value}
function setBackgroundColor(event:Event){if(!selected.value)return;selected.value.style.background=(event.target as HTMLInputElement).value}
function toggleStyle(key:'fontWeight'|'fontStyle'|'textDecoration',on:string,off:string){if(!selected.value)return;updateStyle(key,(selected.value.style as any)[key]===on?off:on)}

function onSelectedImage(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0];if(!file||!selected.value)return
  const reader=new FileReader();reader.onload=()=>{snapshot();if(selected.value)selected.value.src=String(reader.result)};reader.readAsDataURL(file)
}

function exportJson(){
  const blob=new Blob([JSON.stringify({name:model.name,design:model.design,sampleData:model.sampleData,dataConfig:model.dataConfig},null,2)],{type:'application/json'})
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=props.template.code+'.template.json';a.click();URL.revokeObjectURL(a.href)
}
function importJson(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0];if(!file)return
  const reader=new FileReader()
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(String(reader.result));snapshot()
      if(parsed.design)model.design=normalizeDesign(parsed.design)
      if(parsed.sampleData)model.sampleData=parsed.sampleData
      model.dataConfig=parsed.dataConfig||defaultDataConfig()
      if(parsed.name)model.name=parsed.name
      sampleText.value=JSON.stringify(model.sampleData,null,2);message.success('模板 JSON 已导入')
    }catch{message.error('模板 JSON 格式错误')}
  }
  reader.readAsText(file)
}
function applySample(){try{snapshot();model.sampleData=JSON.parse(sampleText.value);sampleOpen.value=false;message.success('样例数据已应用')}catch{message.error('JSON 格式错误')}}

async function save(showToast=true){
  if(!dirty.value){
    if(showToast)message.info('当前没有未保存修改')
    return props.template
  }
  if(templateDisabled.value)throw new Error('已停用模板不能继续编辑')
  saving.value=true
  try{
    const saved=await saveTemplateDraft(props.template.id,{name:model.name,design:model.design,sampleData:model.sampleData,dataConfig:model.dataConfig})
    savedEditorHash.value=serializeEditorState()
    if(showToast)message.success('草稿已保存 · 修订 '+saved.draftRevision)
    emit('saved',saved);return saved
  }catch(e:any){
    const problem=apiProblem(e,'保存失败')
    message.error(problem.message)
    throw e
  }finally{saving.value=false}
}
async function ensureSaved(){return dirty.value?save(false):props.template}
async function runValidation(){
  try{
    await ensureSaved()
    validation.value=await validateTemplate(props.template.id)
    validationOpen.value=true
    return validation.value
  }catch{return null}
}
async function runDataValidation(){
  try{
    await ensureSaved()
    validation.value=await validateTemplate(props.template.id)
    if(validation.value.valid)message.success(validation.value.warnings.length?'数据配置校验通过，但存在提示':'数据配置校验通过')
    return validation.value
  }catch(e:any){
    lastTestAction.value=null
    testError.value=apiProblem(e,'数据配置校验失败')
    return null
  }
}

function clearTestContext(){
  runtimeRenderData.value=null
  runtimeEditorHash.value=null
  activeTestRunId.value=null
  activeTestType.value=null
  activePrinterId.value=''
  testContext.value=null
}
function beginTestAction(action:LastTestAction){
  lastTestAction.value=action
  testError.value=null
  validation.value=null
  clearTestContext()
  previewOpen.value=false
}
async function reloadConnections(){
  connectionsError.value=''
  try{connections.value=await listConnections()}
  catch(e:any){connectionsError.value=apiProblem(e,'数据连接列表读取失败').message}
}
async function retryLastTest(){
  const action=lastTestAction.value
  if(!action)return
  if(action.kind==='QUERY')return runQueryTest(action.queryId,action.params,true)
  if(action.kind==='PLUGIN_PRINT')return runPreparedTest(action.kind,action.params,action.printerId,true)
  return runPreparedTest(action.kind,action.params,'',true)
}
function openNormalPreview(){
  clearTestContext()
  testError.value=null
  testContext.value={label:dirty.value?'本地未保存样例数据':'样例数据'}
  previewOpen.value=true
}
async function runQueryTest(queryId:string,params:Record<string,unknown>,retry=false){
  if(!retry)beginTestAction({kind:'QUERY',queryId,params})
  else{testError.value=null;queryResult.value=null}
  testBusy.value=true
  queryResult.value=null
  try{
    await ensureSaved()
    const result=await testTemplateQuery(props.template.id,queryId,{params})
    queryResult.value=result
    if(result.status==='SUCCESS'){
      testError.value=null
      message.success('查询测试成功')
    }else{
      testError.value={code:result.error?.code||'QUERY_TEST_FAILED',message:result.error?.message||'查询测试失败',queryId,testRunId:result.testRunId}
    }
  }catch(e:any){testError.value=apiProblem(e,'查询测试失败')}
  finally{testBusy.value=false}
}
async function runPreparedTest(
  kind:'PREVIEW'|'SIMULATED_PRINT'|'PLUGIN_PRINT',
  params:Record<string,unknown>,
  printerId='',
  retry=false
){
  if(!retry)beginTestAction(kind==='PLUGIN_PRINT'?{kind,params,printerId}:{kind,params})
  else{testError.value=null;clearTestContext()}
  testBusy.value=true
  try{
    await ensureSaved()
    const input={params,printerId:printerId||undefined}
    const result=kind==='PREVIEW'
      ?await prepareTemplateTestData(props.template.id,input)
      :kind==='SIMULATED_PRINT'
        ?await prepareSimulatedPrint(props.template.id,input)
        :await preparePluginPrint(props.template.id,input)
    if(result.status!=='SUCCESS'||!result.renderData){
      const failed=result.queries.find(q=>q.status==='FAILED')
      testError.value={
        code:result.error?.code||failed?.errorCode||'TEST_DATA_FAILED',
        message:result.error?.message||failed?.errorMessage||'测试数据准备失败',
        queryId:failed?.queryId,
        testRunId:result.testRunId
      }
      return
    }
    runtimeRenderData.value=result.renderData
    runtimeEditorHash.value=serializeEditorState()
    activeTestRunId.value=result.testRunId
    activeTestType.value=kind
    activePrinterId.value=printerId
    testContext.value={
      label:kind==='PREVIEW'?'测试数据预览':kind==='SIMULATED_PRINT'?'模拟打印数据':'插件打印数据',
      target:result.target,
      testRunId:result.testRunId
    }
    testError.value=null
    previewOpen.value=true
  }catch(e:any){testError.value=apiProblem(e,'测试执行失败')}
  finally{testBusy.value=false}
}
async function onPreviewRendered(payload:{pageCount:number;elapsedMs:number}){
  const runId=activeTestRunId.value
  if(!runId)return
  try{
    await reportTemplateRenderResult(runId,{success:true,pageCount:payload.pageCount,elapsedMs:payload.elapsedMs,message:'预览渲染成功'})
    if(activeTestType.value==='SIMULATED_PRINT'){
      await reportTemplatePrintResult(runId,{channel:'SIMULATED',success:true,elapsedMs:payload.elapsedMs,message:'模拟打印文档生成成功'})
      message.success('模拟打印测试成功')
    }
  }catch(e:any){testError.value=apiProblem(e,'测试结果回写失败')}
}
async function onPluginResult(payload:{success:boolean;agentJobId?:string;elapsedMs:number;message?:string}){
  const runId=activeTestRunId.value
  if(!runId)return
  try{
    await reportTemplatePrintResult(runId,{
      channel:'BROWSER_EXTENSION_AGENT',success:payload.success,printerId:activePrinterId.value,
      agentJobId:payload.agentJobId,elapsedMs:payload.elapsedMs,message:payload.message
    })
    if(payload.success){
      testError.value=null
      message.success('插件打印任务已被 Agent 接收')
    }else{
      testError.value={code:'PLUGIN_PRINT_FAILED',message:payload.message||'插件打印失败',testRunId:runId}
    }
  }catch(e:any){testError.value=apiProblem(e,'打印结果回写失败')}
}

async function markTesting(){
  try{
    if(dirty.value)await save(false)
    const t=await markTemplateTesting(props.template.id)
    emit('saved',t);message.success('已进入测试中状态')
  }catch(e:any){message.error(apiProblem(e,'状态更新失败').message)}
}
async function review(){
  if(dirty.value){
    try{await save(false)}catch{return}
    message.warning('修改已保存并回到草稿；请重新进入测试后再提交审核')
    return
  }
  try{
    const result=await validateTemplate(props.template.id);validation.value=result
    if(!result.valid){validationOpen.value=true;return}
    const t=await submitTemplateReview(props.template.id);emit('saved',t);message.success('已提交审核')
  }catch(e:any){message.error(apiProblem(e,'提交审核失败').message)}
}
function openPublish(){
  if(dirty.value){message.warning('存在未保存修改，请重新保存、测试、审核后再发布');return}
  if(props.template.status!=='REVIEWING'){message.warning('只有审核中的模板可以发布');return}
  release.changeNote='';release.scopeType='ALL';release.scopeValues='';publishOpen.value=true
}
async function publish(){
  publishing.value=true
  try{
    const result=await validateTemplate(props.template.id);validation.value=result
    if(!result.valid){publishOpen.value=false;validationOpen.value=true;return}
    const scope:ReleaseScope={type:release.scopeType,values:release.scopeType==='ALL'?[]:release.scopeValues.split(/[，,\n]/).map(v=>v.trim()).filter(Boolean)}
    const t=await publishTemplate(props.template.id,release.changeNote,scope);emit('saved',t);publishOpen.value=false;message.success('已发布 v'+t.publishedVersion)
  }catch(e:any){message.error(apiProblem(e,'发布失败').message)}
  finally{publishing.value=false}
}

function applyAiResult(result:AiLayoutResponse){
  model.design.ai={taskId:result.taskId,status:result.status,provider:result.provider,model:result.model,candidates:(result.candidates||[]).map((c,i)=>({...c,id:c.id||'ai-'+Date.now()+'-'+i,confirmed:false})),lastMessage:result.message,updatedAt:new Date().toISOString()}
}
function acceptCandidate(candidate:AiCandidate){
  const allowed:TemplateElementType[]=['TEXT','LONG_TEXT','TITLE','IMAGE','LINE','RECT','TABLE','BARCODE','QRCODE','DATE','PAGE','AMOUNT','HEADER','FOOTER','WATERMARK']
  if(!allowed.includes(candidate.type)){message.warning('不支持的候选组件类型: '+candidate.type);return}
  snapshot()
  const el=createElement(candidate.type,model.design.elements.length+1,candidate.x,candidate.y)
  Object.assign(el,{w:candidate.w,h:candidate.h,text:candidate.text||el.text,binding:candidate.binding||el.binding})
  if(candidate.style)el.style={...el.style,...candidate.style}
  model.design.elements.push(el);selectedId.value=el.id
  candidate.confirmed=true
}
function acceptAllCandidates(){for(const candidate of model.design.ai?.candidates||[])if(!candidate.confirmed)acceptCandidate(candidate)}
function removeCandidate(candidate:AiCandidate){if(!model.design.ai)return;model.design.ai.candidates=model.design.ai.candidates.filter(c=>c.id!==candidate.id)}

function onKey(e:KeyboardEvent){
  const target=e.target as HTMLElement
  if(['INPUT','TEXTAREA'].includes(target.tagName)||target.isContentEditable)return
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected()}
}
watch(()=>serializeEditorState(),current=>{
  validation.value=null
  queryResult.value=null
  if(runtimeEditorHash.value&&current!==runtimeEditorHash.value){
    clearTestContext()
    if(previewOpen.value)previewOpen.value=false
    message.info('模板已修改，上一轮测试数据已失效，请重新准备测试数据')
  }
})
onMounted(async()=>{
  window.addEventListener('keydown',onKey)
  await reloadConnections()
})
onUnmounted(()=>window.removeEventListener('keydown',onKey))
</script>

<template>
<div class="studio-page">
  <div class="studio-top">
    <div class="studio-title">
      <a-button @click="emit('back')">← 模板中心</a-button>
      <div>
        <div class="title-line"><strong>{{model.name}}</strong><a-tag v-if="dirty" color="orange">未保存</a-tag><a-tag v-else color="green">已同步</a-tag></div>
        <small>{{template.code}} · {{template.status}} · 草稿修订 {{template.draftRevision}}<span v-if="template.publishedVersion"> · 已发布 v{{template.publishedVersion}}</span></small>
      </div>
    </div>
    <a-space wrap>
      <a-button :disabled="!history.length" @click="undo">撤销</a-button>
      <a-button :disabled="!future.length" @click="redo">重做</a-button>
      <a-button @click="openNormalPreview">分页预览 / 打印</a-button>
      <a-button @click="runValidation">校验</a-button>
      <a-button @click="exportJson">导出</a-button>
      <a-button @click="importing?.click()">导入</a-button>
      <input ref="importing" type="file" accept=".json,application/json" hidden @change="importJson"/>
      <a-button :loading="saving" :disabled="templateDisabled||!dirty" @click="save()">保存草稿</a-button>
      <a-button :disabled="templateDisabled||(!dirty&&template.status!=='DRAFT')" @click="markTesting">进入测试</a-button>
      <a-button :disabled="templateDisabled||dirty||template.status!=='TESTING'" @click="review">提交审核</a-button>
      <a-button type="primary" :disabled="templateDisabled||dirty||template.status!=='REVIEWING'" @click="openPublish">发布</a-button>
    </a-space>
  </div>

  <a-alert
    v-if="dirty&&template.status!=='DRAFT'"
    type="warning"
    show-icon
    class="workflow-alert"
    message="当前存在本地修改"
    :description="'保存后模板会回到 DRAFT，必须重新经过测试和审核；当前 '+template.status+' 状态不会沿用。'"
  />

  <div class="studio-grid">
    <aside class="studio-pane palette">
      <h3>组件</h3><p>点击或拖入画布</p>
      <div class="palette-grid"><button v-for="item in palette" :key="item.type" draggable="true" @dragstart="dragStart($event,item.type)" @click="addElement(item.type)"><b>{{item.icon}}</b><span>{{item.label}}</span></button></div>
      <h3 class="layer-head">图层</h3>
      <div class="layers">
        <div v-for="el in [...model.design.elements].sort((a,b)=>b.zIndex-a.zIndex)" :key="el.id" class="layer-row" :class="{active:el.id===selectedId}" @click="selectedId=el.id">
          <span>{{el.type}} · {{el.text||el.binding}}</span>
          <div><button @click.stop="el.visible=!el.visible">{{el.visible?'◉':'○'}}</button><button @click.stop="el.locked=!el.locked">{{el.locked?'🔒':'🔓'}}</button></div>
        </div>
      </div>

      <template v-if="model.design.ai?.candidates?.length">
        <h3 class="layer-head">AI 候选</h3>
        <a-button size="small" block @click="acceptAllCandidates">接受全部未确认</a-button>
        <div class="ai-candidates">
          <div v-for="candidate in model.design.ai.candidates" :key="candidate.id" class="candidate" :class="{confirmed:candidate.confirmed}">
            <div><b>{{candidate.type}}</b><span>{{Math.round((candidate.confidence||0)*100)}}%</span></div>
            <small>{{candidate.text||candidate.binding||'未命名区域'}}</small>
            <a-space><a-button size="small" :disabled="candidate.confirmed" @click="acceptCandidate(candidate)">接受</a-button><a-button size="small" danger @click="removeCandidate(candidate)">删除</a-button></a-space>
          </div>
        </div>
      </template>
    </aside>

    <main class="canvas-pane">
      <div class="canvas-toolbar"><a-space><a-switch v-model:checked="model.design.grid"/> 网格 <a-switch v-model:checked="model.design.snap"/> 吸附/智能参考线 <span class="muted">1 mm = 3 px · 网格 5 mm</span></a-space></div>
      <div class="ruler-top"></div><div class="ruler-left"></div>
      <div class="canvas-scroll"><div ref="canvasRef" class="paper-canvas" :style="canvasStyle" @dragover.prevent @drop="dropCanvas">
        <template v-if="model.design.referenceImage">
          <img v-if="model.design.referenceImage.viewMode==='original'" class="canvas-reference" :src="model.design.referenceImage.originalDataUrl" :style="{opacity:model.design.referenceImage.opacity}"/>
          <img v-else class="canvas-reference" :src="model.design.referenceImage.correctedDataUrl" :style="{opacity:model.design.referenceImage.opacity}"/>
          <img v-if="model.design.referenceImage.viewMode==='overlay'||model.design.referenceImage.viewMode==='difference'" class="canvas-reference reference-overlay" :class="{difference:model.design.referenceImage.viewMode==='difference'}" :src="model.design.referenceImage.originalDataUrl"/>
        </template>
        <div class="print-margin" :style="{left:model.design.paper.marginLeft*3+'px',right:model.design.paper.marginRight*3+'px',top:model.design.paper.marginTop*3+'px',bottom:model.design.paper.marginBottom*3+'px'}"></div>
        <div v-if="snapGuideX!==null" class="snap-guide vertical" :style="{left:(snapGuideX*3)+'px'}"></div>
        <div v-if="snapGuideY!==null" class="snap-guide horizontal" :style="{top:(snapGuideY*3)+'px'}"></div>
        <div v-for="el in sortedElements" :key="el.id" class="design-el" :class="{selected:el.id===selectedId,locked:el.locked,'is-line':el.type==='LINE','is-watermark':el.type==='WATERMARK'}" :style="elementStyle(el)" @pointerdown="pointerDown($event,el,'move')" @click.stop="selectedId=el.id">
          <ElementRenderer :element="el" :data="model.sampleData"/>
          <span v-if="el.id===selectedId&&!el.locked" class="resize-handle" @pointerdown.stop="pointerDown($event,el,'resize')"></span>
        </div>
      </div></div>
    </main>

    <aside class="studio-pane props">
      <template v-if="selected">
        <div class="prop-head"><h3>组件属性</h3><a-space><a-button size="small" @click="duplicateSelected">复制</a-button><a-button size="small" danger @click="deleteSelected">删除</a-button></a-space></div>
        <a-form layout="vertical" size="small">
          <a-form-item label="类型"><a-input :value="selected.type" disabled/></a-form-item>
          <a-form-item label="文本 / 编码内容"><a-textarea v-model:value="selected.text" :rows="2"/></a-form-item>
          <a-form-item label="数据绑定"><a-input v-model:value="selected.binding" placeholder="patientName / items / order.code"/></a-form-item>
          <div class="four-fields"><a-form-item label="X"><a-input-number v-model:value="selected.x"/></a-form-item><a-form-item label="Y"><a-input-number v-model:value="selected.y"/></a-form-item><a-form-item label="宽"><a-input-number v-model:value="selected.w"/></a-form-item><a-form-item label="高"><a-input-number v-model:value="selected.h"/></a-form-item></div>

          <a-collapse ghost>
            <a-collapse-panel key="style" header="完整样式">
              <a-form-item label="字体"><a-select v-model:value="selected.style.fontFamily"><a-select-option value='Arial, "PingFang SC", "Microsoft YaHei", sans-serif'>系统无衬线</a-select-option><a-select-option value='"SimSun", serif'>宋体</a-select-option><a-select-option value='"Microsoft YaHei", sans-serif'>微软雅黑</a-select-option><a-select-option value='monospace'>等宽</a-select-option></a-select></a-form-item>
              <div class="two-fields"><a-form-item label="字号(pt)"><a-input-number v-model:value="selected.fontSize" :min="5" :max="96"/></a-form-item><a-form-item label="旋转"><a-input-number v-model:value="selected.style.rotation" :min="-180" :max="180"/></a-form-item></div>
              <a-space wrap><a-button size="small" :type="selected.style.fontWeight==='700'?'primary':'default'" @click="toggleStyle('fontWeight','700','400')"><b>B</b></a-button><a-button size="small" :type="selected.style.fontStyle==='italic'?'primary':'default'" @click="toggleStyle('fontStyle','italic','normal')"><i>I</i></a-button><a-button size="small" :type="selected.style.textDecoration==='underline'?'primary':'default'" @click="toggleStyle('textDecoration','underline','none')"><u>U</u></a-button></a-space>
              <div class="color-row"><label>文字 <input type="color" v-model="selected.style.color"/></label><label>背景 <input type="color" :value="selected.style.background==='transparent'?'#ffffff':selected.style.background" @input="setBackgroundColor"/></label><label>边框 <input type="color" v-model="selected.style.borderColor"/></label></div>
              <div class="two-fields"><a-form-item label="边框(px)"><a-input-number v-model:value="selected.style.borderWidth" :min="0" :max="10"/></a-form-item><a-form-item label="透明度"><a-input-number v-model:value="selected.style.opacity" :min="0" :max="1" :step="0.05"/></a-form-item></div>
              <a-form-item label="水平对齐"><a-radio-group v-model:value="selected.style.textAlign" size="small"><a-radio-button value="left">左</a-radio-button><a-radio-button value="center">中</a-radio-button><a-radio-button value="right">右</a-radio-button></a-radio-group></a-form-item>
              <a-form-item label="垂直对齐"><a-radio-group v-model:value="selected.style.verticalAlign" size="small"><a-radio-button value="top">上</a-radio-button><a-radio-button value="middle">中</a-radio-button><a-radio-button value="bottom">下</a-radio-button></a-radio-group></a-form-item>
            </a-collapse-panel>
          </a-collapse>

          <template v-if="selected.type==='IMAGE'">
            <a-form-item label="图片资源"><a-button block @click="imageInput?.click()">上传 / 替换图片</a-button><input ref="imageInput" type="file" accept="image/png,image/jpeg,image/svg+xml" hidden @change="onSelectedImage"/></a-form-item>
          </template>
          <template v-if="selected.type==='BARCODE'">
            <a-form-item label="条码格式"><a-select v-model:value="selected.barcodeFormat"><a-select-option value="CODE128">CODE128</a-select-option><a-select-option value="CODE39">CODE39</a-select-option><a-select-option value="EAN13">EAN13</a-select-option><a-select-option value="EAN8">EAN8</a-select-option><a-select-option value="UPC">UPC</a-select-option></a-select></a-form-item>
          </template>
          <template v-if="selected.type==='TABLE'&&selected.table"><a-divider/><TableDesigner v-model="selected.table"/></template>

          <div class="align-grid"><a-button size="small" @click="alignSelected('left')">左对齐</a-button><a-button size="small" @click="alignSelected('center')">水平居中</a-button><a-button size="small" @click="alignSelected('right')">右对齐</a-button><a-button size="small" @click="alignSelected('top')">顶对齐</a-button><a-button size="small" @click="alignSelected('middle')">垂直居中</a-button><a-button size="small" @click="alignSelected('bottom')">底对齐</a-button></div>
          <a-space style="margin-top:8px"><a-button size="small" @click="moveLayer(1)">上移图层</a-button><a-button size="small" @click="moveLayer(-1)">下移图层</a-button></a-space>
        </a-form>
      </template>

      <a-divider/>
      <h3>纸张</h3>
      <a-space wrap><a-button size="small" @click="paperPreset('A4')">A4</a-button><a-button size="small" @click="paperPreset('A5')">A5</a-button><a-button size="small" @click="paperPreset('80MM')">80mm 小票</a-button><a-button size="small" @click="paperPreset('LABEL')">100×60 标签</a-button></a-space>
      <a-form layout="vertical" size="small" class="paper-form">
        <a-form-item label="方向"><a-radio-group v-model:value="model.design.paper.orientation"><a-radio-button value="PORTRAIT">纵向</a-radio-button><a-radio-button value="LANDSCAPE">横向</a-radio-button></a-radio-group></a-form-item>
        <div class="two-fields"><a-form-item label="宽(mm)"><a-input-number v-model:value="model.design.paper.width"/></a-form-item><a-form-item label="高(mm)"><a-input-number v-model:value="model.design.paper.height"/></a-form-item></div>
        <div class="two-fields"><a-form-item label="DPI"><a-input-number v-model:value="model.design.paper.dpi" :min="72" :max="1200"/></a-form-item><a-form-item label="纸张名"><a-input v-model:value="model.design.paper.size"/></a-form-item></div>
        <div class="two-fields">
          <a-form-item label="自适应高度"><a-switch v-model:checked="model.design.paper.autoHeight"/></a-form-item>
          <a-form-item label="最大高度(mm)"><a-input-number v-model:value="model.design.paper.autoHeightMaxMm" :min="100" :max="3000" :disabled="!model.design.paper.autoHeight"/></a-form-item>
        </div>
        <a-alert v-if="model.design.paper.autoHeight" type="info" show-icon message="动态表格会按实际行数向下扩展，表格后的元素自动下移；适合 58/80mm 小票和连续纸。" style="margin-bottom:8px"/>
        <div class="four-fields"><a-form-item label="上"><a-input-number v-model:value="model.design.paper.marginTop"/></a-form-item><a-form-item label="右"><a-input-number v-model:value="model.design.paper.marginRight"/></a-form-item><a-form-item label="下"><a-input-number v-model:value="model.design.paper.marginBottom"/></a-form-item><a-form-item label="左"><a-input-number v-model:value="model.design.paper.marginLeft"/></a-form-item></div>
      </a-form>

      <a-divider/>
      <div class="prop-head"><h3>样例数据</h3><a-button size="small" @click="sampleOpen=true">编辑 JSON</a-button></div>
      <pre class="sample-preview">{{JSON.stringify(model.sampleData,null,2)}}</pre>

      <a-divider/>
      <TemplateDataPanel
        :config="model.dataConfig"
        :connections="connections"
        :busy="testBusy"
        :dirty="dirty"
        :can-retry="!!lastTestAction"
        :query-result="queryResult"
        :server-error="testError"
        :server-validation="validation"
        :test-context="testContext"
        :connections-error="connectionsError"
        @snapshot="snapshot"
        @validate="runDataValidation"
        @retry="retryLastTest"
        @dismiss-error="testError=null"
        @reload-connections="reloadConnections"
        @test-query="runQueryTest"
        @preview="(params)=>runPreparedTest('PREVIEW',params)"
        @simulated="(params)=>runPreparedTest('SIMULATED_PRINT',params)"
        @plugin="(params,printerId)=>runPreparedTest('PLUGIN_PRINT',params,printerId)"
      />

      <a-divider/>
      <h3>照片参照 / AI 定位</h3>
      <ReferenceImagePanel v-model="model.design.referenceImage" :template-id="template.id" :paper="model.design.paper" @ai-result="applyAiResult"/>
    </aside>
  </div>

  <a-modal v-model:open="sampleOpen" title="编辑样例数据 JSON" width="760px" @ok="applySample"><a-textarea v-model:value="sampleText" :rows="20"/></a-modal>

  <a-modal v-model:open="validationOpen" title="发布前校验" :footer="null" width="720px">
    <a-result v-if="validation" :status="validation.valid?'success':'error'" :title="validation.valid?'校验通过':'发现阻断问题'" :sub-title="validation.valid?'可进入审核或发布':'修复错误后才能发布'"/>
    <template v-if="validation?.errors.length"><h3>错误</h3><a-alert v-for="item in validation.errors" :key="item" type="error" :message="item" show-icon style="margin-bottom:6px"/></template>
    <template v-if="validation?.warnings.length"><h3>警告</h3><a-alert v-for="item in validation.warnings" :key="item" type="warning" :message="item" show-icon style="margin-bottom:6px"/></template>
  </a-modal>

  <a-modal v-model:open="publishOpen" title="发布模板版本" :confirm-loading="publishing" @ok="publish">
    <a-form layout="vertical">
      <a-form-item label="发布说明"><a-textarea v-model:value="release.changeNote" :rows="3" placeholder="本次修改说明"/></a-form-item>
      <a-form-item label="生效范围"><a-select v-model:value="release.scopeType"><a-select-option value="ALL">全部</a-select-option><a-select-option value="ORG">组织</a-select-option><a-select-option value="CAMPUS">院区</a-select-option><a-select-option value="DEPARTMENT">科室</a-select-option><a-select-option value="TERMINAL">终端</a-select-option></a-select></a-form-item>
      <a-form-item v-if="release.scopeType!=='ALL'" label="范围值"><a-textarea v-model:value="release.scopeValues" :rows="3" placeholder="多个编码使用逗号或换行分隔"/></a-form-item>
    </a-form>
  </a-modal>

  <PreviewModal
    v-model:open="previewOpen"
    :template="previewTemplate"
    :render-data="runtimeRenderData"
    :show-reference="false"
    :context="testContext"
    :plugin-print="activeTestType==='PLUGIN_PRINT'&&activeTestRunId?{testRunId:activeTestRunId,printerId:activePrinterId}:null"
    @rendered="onPreviewRendered"
    @plugin-result="onPluginResult"
  />
</div>
</template>