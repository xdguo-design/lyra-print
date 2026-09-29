<script setup lang="ts">
import { computed,nextTick,onBeforeUnmount,onMounted,ref,watch } from 'vue'
import {
  CSS_PX_PER_MM,
  PRINT_CSS,
  calculatePreviewScale,
  paperModelFromTemplatePaper,
  renderPreview,
  type PreviewPayload,
  type PreviewRenderResult,
  type TemplatePaper
} from '@print-platform/preview-browser'

const props=withDefaults(defineProps<{
  payload:PreviewPayload|null
  frameHeight?:number
}>(),{
  frameHeight:680
})

const emit=defineEmits<{
  rendered:[result:PreviewRenderResult]
}>()

const host=ref<HTMLElement|null>(null)
const iframe=ref<HTMLIFrameElement|null>(null)
const loading=ref(false)
const error=ref('')
const result=ref<PreviewRenderResult|null>(null)
const scale=ref(1)
let observer:ResizeObserver|undefined

const paperSummary=computed(()=>{
  if(!props.payload)return ''
  const paper=(props.payload.design as any)?.paper as TemplatePaper|undefined
  if(!paper)return ''
  const model=paperModelFromTemplatePaper(paper)
  const height=model.heightMode==='AUTO'?'AUTO':`${model.heightMm}mm`
  return `${model.kind} · ${model.widthMm}mm × ${height} · ${model.dpi} DPI`
})

function buildPreviewDocument(rendered:PreviewRenderResult,currentScale:number){
  const gap=18
  const widthPx=rendered.pageSize.width*CSS_PX_PER_MM
  const pageHeightPx=rendered.pageSize.height*CSS_PX_PER_MM
  const naturalHeight=pageHeightPx*rendered.pageCount+gap*Math.max(0,rendered.pageCount-1)
  const stageWidth=Math.max(1,widthPx*currentScale)
  const stageHeight=Math.max(1,naturalHeight*currentScale)

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
${PRINT_CSS}
html,body{margin:0;min-height:100%;background:#e8eef3}
body{padding:24px;overflow:auto}
.preview-stage{position:relative;width:${stageWidth}px;height:${stageHeight}px;margin:0 auto}
.print-pages{
  position:absolute;
  left:0;
  top:0;
  width:${widthPx}px;
  display:grid;
  gap:${gap}px;
  transform:scale(${currentScale});
  transform-origin:top left;
}
.print-page{box-shadow:0 12px 34px rgba(29,48,68,.18);outline:1px solid rgba(82,107,128,.18)}
</style>
</head>
<body>
<div class="preview-stage">${rendered.bodyHtml}</div>
</body>
</html>`
}

async function refresh(){
  error.value=''
  if(!props.payload){
    result.value=null
    if(iframe.value)iframe.value.srcdoc=''
    return
  }
  loading.value=true
  try{
    const rendered=await renderPreview(props.payload)
    result.value=rendered
    await nextTick()
    updateScale()
    emit('rendered',rendered)
  }catch(e){
    error.value=e instanceof Error?e.message:String(e)
    result.value=null
  }finally{
    loading.value=false
  }
}

function updateScale(){
  if(!props.payload||!result.value||!host.value||!iframe.value)return
  const paper=(props.payload.design as any)?.paper as TemplatePaper|undefined
  if(!paper)return
  const model=paperModelFromTemplatePaper(paper)
  const viewport=Math.max(280,host.value.clientWidth-12)
  scale.value=calculatePreviewScale(
    model,
    viewport,
    result.value.pageSize.height,
    {paddingPx:48,allowUpscale:true}
  )
  iframe.value.srcdoc=buildPreviewDocument(result.value,scale.value)
}

watch(()=>props.payload,refresh,{deep:true})

onMounted(()=>{
  observer=new ResizeObserver(()=>updateScale())
  if(host.value)observer.observe(host.value)
  refresh()
})

onBeforeUnmount(()=>observer?.disconnect())
</script>

<template>
  <section ref="host" class="preview-host">
    <header class="preview-toolbar">
      <div>
        <strong>业务组件预览</strong>
        <span>{{ paperSummary }}</span>
      </div>
      <div class="preview-metrics">
        <span v-if="result">{{ result.pageCount }} 页</span>
        <span>{{ Math.round(scale*100) }}%</span>
      </div>
    </header>

    <div v-if="error" class="preview-error">
      <strong>预览失败</strong>
      <span>{{ error }}</span>
    </div>

    <div v-else class="frame-shell" :class="{loading}">
      <div v-if="loading" class="loading-mask">正在渲染模板…</div>
      <iframe
        ref="iframe"
        title="Print Platform business preview"
        sandbox="allow-same-origin"
        :style="{height:frameHeight+'px'}"
      />
    </div>
  </section>
</template>

<style scoped>
.preview-host{display:grid;gap:10px;min-width:0}
.preview-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px}
.preview-toolbar>div:first-child{display:grid;gap:3px}
.preview-toolbar strong{font-size:14px;color:#182638}
.preview-toolbar span{font-size:12px;color:#6e7d8b}
.preview-metrics{display:flex;gap:8px}
.preview-metrics span{padding:5px 9px;border:1px solid #d6e0e8;border-radius:999px;background:#fff;color:#42566a}
.frame-shell{position:relative;overflow:hidden;border:1px solid #d7e1e8;border-radius:14px;background:#e8eef3}
.frame-shell iframe{display:block;width:100%;border:0;background:#e8eef3}
.frame-shell.loading iframe{opacity:.5}
.loading-mask{position:absolute;z-index:3;inset:0;display:grid;place-items:center;background:rgba(238,244,248,.72);font-size:13px;color:#52677a}
.preview-error{display:grid;gap:5px;padding:24px;border:1px solid #efc8c8;border-radius:14px;background:#fff7f7;color:#a23d3d}
.preview-error span{font-size:13px}
</style>
