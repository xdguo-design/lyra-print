<script setup lang="ts">
import { computed,ref } from 'vue'
import { message } from 'ant-design-vue'
import { recognizeTemplateLayout } from '../api'
import type { AiLayoutResponse,ReferenceImage,ReferencePoint,TemplatePaper } from '../types'

const props=defineProps<{
  templateId:string
  modelValue?:ReferenceImage
  paper:TemplatePaper
}>()
const emit=defineEmits<{
  (e:'update:modelValue',value:ReferenceImage|undefined):void
  (e:'ai-result',value:AiLayoutResponse):void
}>()

const processing=ref(false)
const recognizing=ref(false)
const hint=ref('')
const previewRef=ref<HTMLElement|null>(null)
let dragging=-1

const value=computed(()=>props.modelValue)
const viewSrc=computed(()=>value.value?.correctedDataUrl||value.value?.originalDataUrl||'')

function update(patch:Partial<ReferenceImage>){
  if(!value.value)return
  emit('update:modelValue',{...value.value,...patch,updatedAt:new Date().toISOString()})
}

async function onFile(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0]
  if(!file)return
  if(!/^image\/(png|jpeg|jpg)$/i.test(file.type)){message.error('只支持 PNG/JPG');return}
  const reader=new FileReader()
  reader.onload=async()=>{
    const src=String(reader.result)
    const next:ReferenceImage={
      originalDataUrl:src,correctedDataUrl:src,fileName:file.name,
      corners:[{x:.03,y:.03},{x:.97,y:.03},{x:.97,y:.97},{x:.03,y:.97}],
      rotation:0,opacity:.55,locked:true,viewMode:'corrected',
      paperWidth:props.paper.width,paperHeight:props.paper.height,dpi:props.paper.dpi||96,
      sensitiveConfirmed:false,detectedAutomatically:false,updatedAt:new Date().toISOString()
    }
    emit('update:modelValue',next)
    await autoDetect(next)
  }
  reader.readAsDataURL(file)
}

function loadImage(src:string):Promise<HTMLImageElement>{
  return new Promise((resolve,reject)=>{
    const img=new Image()
    img.onload=()=>resolve(img)
    img.onerror=reject
    img.src=src
  })
}

async function autoDetect(base=value.value){
  if(!base)return
  processing.value=true
  try{
    const img=await loadImage(base.originalDataUrl)
    const scale=Math.min(1,500/Math.max(img.width,img.height))
    const w=Math.max(2,Math.round(img.width*scale)),h=Math.max(2,Math.round(img.height*scale))
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!
    ctx.drawImage(img,0,0,w,h)
    const data=ctx.getImageData(0,0,w,h).data
    const cornerSamples=[[0,0],[w-1,0],[w-1,h-1],[0,h-1]]
    let br=0,bg=0,bb=0
    for(const [x,y] of cornerSamples){const i=(y*w+x)*4;br+=data[i];bg+=data[i+1];bb+=data[i+2]}
    br/=4;bg/=4;bb/=4
    let tl:{x:number;y:number;s:number}|null=null,tr:null|{x:number;y:number;s:number}=null,brp:null|{x:number;y:number;s:number}=null,bl:null|{x:number;y:number;s:number}=null
    const step=Math.max(1,Math.floor(Math.max(w,h)/350))
    for(let y=0;y<h;y+=step){
      for(let x=0;x<w;x+=step){
        const i=(y*w+x)*4
        const distance=Math.abs(data[i]-br)+Math.abs(data[i+1]-bg)+Math.abs(data[i+2]-bb)
        if(distance<75)continue
        const s1=x+y,s2=x-y
        if(!tl||s1<tl.s)tl={x,y,s:s1}
        if(!tr||s2>tr.s)tr={x,y,s:s2}
        if(!brp||s1>brp.s)brp={x,y,s:s1}
        if(!bl||s2<bl.s)bl={x,y,s:s2}
      }
    }
    if(tl&&tr&&brp&&bl){
      const corners=[tl,tr,brp,bl].map(p=>({x:p.x/w,y:p.y/h}))
      const next={...base,corners,detectedAutomatically:true,updatedAt:new Date().toISOString()}
      emit('update:modelValue',next)
      await correct(next)
      message.success('已自动建议四角，可继续手工调整')
    }else{
      await correct(base)
      message.warning('自动角点不稳定，请手工调整四角')
    }
  }catch{message.error('照片读取失败')}
  finally{processing.value=false}
}

function solve(matrix:number[][],vector:number[]):number[]{
  const n=vector.length
  const a=matrix.map((row,i)=>[...row,vector[i]])
  for(let col=0;col<n;col++){
    let pivot=col
    for(let r=col+1;r<n;r++)if(Math.abs(a[r][col])>Math.abs(a[pivot][col]))pivot=r
    ;[a[col],a[pivot]]=[a[pivot],a[col]]
    const d=a[col][col]
    if(Math.abs(d)<1e-10)throw new Error('无法计算透视矩阵')
    for(let c=col;c<=n;c++)a[col][c]/=d
    for(let r=0;r<n;r++){
      if(r===col)continue
      const f=a[r][col]
      for(let c=col;c<=n;c++)a[r][c]-=f*a[col][c]
    }
  }
  return a.map(row=>row[n])
}

function homography(dst:ReferencePoint[],src:ReferencePoint[]):number[]{
  const m:number[][]=[],b:number[]=[]
  for(let i=0;i<4;i++){
    const u=dst[i].x,v=dst[i].y,x=src[i].x,y=src[i].y
    m.push([u,v,1,0,0,0,-x*u,-x*v]);b.push(x)
    m.push([0,0,0,u,v,1,-y*u,-y*v]);b.push(y)
  }
  return solve(m,b)
}

function applyH(h:number[],x:number,y:number):ReferencePoint{
  const d=h[6]*x+h[7]*y+1
  return {x:(h[0]*x+h[1]*y+h[2])/d,y:(h[3]*x+h[4]*y+h[5])/d}
}

async function correct(base=value.value){
  if(!base)return
  processing.value=true
  try{
    const img=await loadImage(base.originalDataUrl)
    const src=base.corners.map(p=>({x:p.x*(img.width-1),y:p.y*(img.height-1)}))
    const aspect=Math.max(.05,base.paperHeight/base.paperWidth)
    let outW=800,outH=Math.round(outW*aspect)
    if(outH>1200){outH=1200;outW=Math.round(outH/aspect)}
    outW=Math.max(120,outW);outH=Math.max(120,outH)

    const sourceCanvas=document.createElement('canvas');sourceCanvas.width=img.width;sourceCanvas.height=img.height
    const sourceCtx=sourceCanvas.getContext('2d',{willReadFrequently:true})!
    sourceCtx.drawImage(img,0,0)
    const source=sourceCtx.getImageData(0,0,img.width,img.height)
    const out=document.createElement('canvas');out.width=outW;out.height=outH
    const outCtx=out.getContext('2d')!
    const target=outCtx.createImageData(outW,outH)
    const h=homography([{x:0,y:0},{x:outW-1,y:0},{x:outW-1,y:outH-1},{x:0,y:outH-1}],src)

    for(let y=0;y<outH;y++){
      for(let x=0;x<outW;x++){
        const p=applyH(h,x,y)
        const sx=Math.max(0,Math.min(img.width-1,Math.round(p.x)))
        const sy=Math.max(0,Math.min(img.height-1,Math.round(p.y)))
        const si=(sy*img.width+sx)*4,di=(y*outW+x)*4
        target.data[di]=source.data[si];target.data[di+1]=source.data[si+1];target.data[di+2]=source.data[si+2];target.data[di+3]=255
      }
    }
    outCtx.putImageData(target,0,0)
    let corrected=out
    const rotation=((base.rotation%360)+360)%360
    if(rotation){
      const radians=rotation*Math.PI/180
      const rotated=document.createElement('canvas')
      const swap=rotation===90||rotation===270
      rotated.width=swap?out.height:out.width;rotated.height=swap?out.width:out.height
      const rctx=rotated.getContext('2d')!
      rctx.translate(rotated.width/2,rotated.height/2);rctx.rotate(radians);rctx.drawImage(out,-out.width/2,-out.height/2)
      corrected=rotated
    }
    update({correctedDataUrl:corrected.toDataURL('image/png'),paperWidth:props.paper.width,paperHeight:props.paper.height})
  }catch(e:any){message.error(e?.message||'透视校正失败')}
  finally{processing.value=false}
}

function pointerDown(index:number,e:PointerEvent){
  dragging=index
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function pointerMove(e:PointerEvent){
  if(dragging<0||!value.value||!previewRef.value)return
  const rect=previewRef.value.getBoundingClientRect()
  const point={x:Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))}
  const corners=value.value.corners.map((p,i)=>i===dragging?point:p)
  update({corners,detectedAutomatically:false})
}
async function pointerUp(){if(dragging>=0){dragging=-1;await correct()}}

async function recognize(){
  if(!value.value)return
  if(!value.value.sensitiveConfirmed){message.warning('请先确认敏感图片外发提示');return}
  recognizing.value=true
  try{
    const result=await recognizeTemplateLayout(props.templateId,{
      imageDataUrl:value.value.correctedDataUrl,
      paperWidth:props.paper.width,paperHeight:props.paper.height,
      sensitiveImageConfirmed:true,hint:hint.value
    })
    emit('ai-result',result)
    result.status==='SUCCESS'?message.success(result.message):message.warning(result.message)
  }catch(e:any){message.error(e?.response?.data?.detail||'AI 识别请求失败')}
  finally{recognizing.value=false}
}

function clear(){emit('update:modelValue',undefined)}
</script>

<template>
<div class="reference-tool">
  <div class="reference-actions">
    <label class="upload-btn">上传/拍摄照片<input type="file" accept="image/png,image/jpeg" capture="environment" hidden @change="onFile"/></label>
    <a-button v-if="value" size="small" :loading="processing" @click="autoDetect()">自动角点</a-button>
    <a-button v-if="value" size="small" :loading="processing" @click="correct()">重新校正</a-button>
    <a-button v-if="value" size="small" danger @click="clear">移除</a-button>
  </div>

  <template v-if="value">
    <div class="source-editor">
      <div ref="previewRef" class="photo-wrap" @pointermove="pointerMove" @pointerup="pointerUp">
        <img :src="value.originalDataUrl"/>
        <svg class="corner-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon :points="value.corners.map(p=>(p.x*100)+','+(p.y*100)).join(' ')" />
        </svg>
        <span v-for="(p,i) in value.corners" :key="i" class="corner" :style="{left:(p.x*100)+'%',top:(p.y*100)+'%'}" @pointerdown.stop="pointerDown(i,$event)">{{i+1}}</span>
      </div>
    </div>

    <div class="two-grid">
      <a-form-item label="旋转">
        <a-select :value="value.rotation" @update:value="update({rotation:Number($event)})">
          <a-select-option :value="0">0°</a-select-option><a-select-option :value="90">90°</a-select-option><a-select-option :value="180">180°</a-select-option><a-select-option :value="270">270°</a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item label="DPI"><a-input-number :value="value.dpi" @update:value="update({dpi:Number($event)||96})" :min="72" :max="1200"/></a-form-item>
    </div>
    <a-form-item label="背景透明度"><a-slider :value="value.opacity" @update:value="update({opacity:Number($event)})" :min="0" :max="1" :step="0.05"/></a-form-item>
    <a-space wrap><span>背景锁定</span><a-switch :checked="value.locked" @update:checked="update({locked:Boolean($event)})"/><a-tag :color="value.detectedAutomatically?'green':'blue'">{{value.detectedAutomatically?'自动角点':'手工角点'}}</a-tag></a-space>

    <a-radio-group style="margin:10px 0" :value="value.viewMode" @update:value="update({viewMode:$event})" size="small">
      <a-radio-button value="corrected">矫正</a-radio-button><a-radio-button value="original">原图</a-radio-button><a-radio-button value="overlay">叠加</a-radio-button><a-radio-button value="difference">差异</a-radio-button>
    </a-radio-group>
    <div class="compare">
      <img v-if="value.viewMode==='original'" :src="value.originalDataUrl"/>
      <img v-else :src="viewSrc"/>
      <img v-if="value.viewMode==='overlay'||value.viewMode==='difference'" class="compare-overlay" :class="{difference:value.viewMode==='difference'}" :src="value.originalDataUrl"/>
    </div>

    <a-divider/>
    <strong>外部 AI 识别（可选）</strong>
    <p class="hint">AI 只生成候选组件。没有配置 AI 服务时，照片校正和手工设计不受影响。</p>
    <a-checkbox :checked="value.sensitiveConfirmed" @update:checked="update({sensitiveConfirmed:Boolean($event)})">我确认该图片可按当前策略发送到外部 AI；敏感信息已核对/脱敏</a-checkbox>
    <a-textarea v-model:value="hint" :rows="2" placeholder="可选：例如这是门诊收费票据，请重点识别标题、明细表和合计区域"/>
    <a-button block type="primary" :loading="recognizing" style="margin-top:8px" @click="recognize">AI 识别与定位</a-button>
  </template>
</div>
</template>

<style scoped>
.reference-tool{font-size:12px}.reference-actions{display:flex;gap:6px;flex-wrap:wrap}.upload-btn{display:inline-flex;align-items:center;padding:4px 10px;border:1px solid #1677ff;color:#1677ff;border-radius:6px;cursor:pointer}
.source-editor{margin:10px 0}.photo-wrap{position:relative;width:100%;max-height:220px;overflow:hidden;background:#111;border-radius:8px;touch-action:none}.photo-wrap img{display:block;width:100%;height:auto;max-height:220px;object-fit:contain}.corner-lines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.corner-lines polygon{fill:rgba(34,153,255,.13);stroke:#25a4ff;stroke-width:.7;vector-effect:non-scaling-stroke}.corner{position:absolute;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:#1677ff;color:#fff;font-size:10px;cursor:grab;touch-action:none}
.two-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.two-grid .ant-input-number{width:100%}.compare{height:150px;position:relative;overflow:hidden;background:#eee;border-radius:8px}.compare img{width:100%;height:100%;object-fit:contain}.compare-overlay{position:absolute;inset:0;opacity:.45}.compare-overlay.difference{mix-blend-mode:difference;opacity:.85}.hint{color:#8499aa;font-size:11px;margin:5px 0}
</style>