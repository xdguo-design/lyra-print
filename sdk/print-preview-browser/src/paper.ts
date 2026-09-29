export type PaperKind='STANDARD'|'ROLL'|'LABEL'
export type PaperOrientation='PORTRAIT'|'LANDSCAPE'
export type PaperHeightMode='FIXED'|'AUTO'
export type PaperScaleMode='FIT'|'ACTUAL'

export interface PaperMargins{
  top:number
  right:number
  bottom:number
  left:number
}

export interface AutoHeightRule{
  minMm:number
  maxMm:number
  footerSpaceMm:number
}

export interface LabelLayout{
  mode:'SINGLE'|'SHEET'
  columns:number
  rows:number
  gapXmm:number
  gapYmm:number
}

export interface PaperModel{
  schemaVersion:1
  id:string
  name:string
  kind:PaperKind
  unit:'mm'
  widthMm:number
  heightMm:number|null
  orientation:PaperOrientation
  heightMode:PaperHeightMode
  scaleMode:PaperScaleMode
  dpi:number
  margins:PaperMargins
  autoHeight?:AutoHeightRule
  label?:LabelLayout
}

export interface PaperValidationResult{
  valid:boolean
  errors:string[]
  warnings:string[]
}

export interface PreviewScaleOptions{
  paddingPx?:number
  minScale?:number
  maxScale?:number
  allowUpscale?:boolean
}

export const CSS_PX_PER_MM=96/25.4

export const A4_PAPER:PaperModel={
  schemaVersion:1,
  id:'A4',
  name:'A4',
  kind:'STANDARD',
  unit:'mm',
  widthMm:210,
  heightMm:297,
  orientation:'PORTRAIT',
  heightMode:'FIXED',
  scaleMode:'FIT',
  dpi:300,
  margins:{top:10,right:10,bottom:10,left:10}
}

export const ROLL_80_PAPER:PaperModel={
  schemaVersion:1,
  id:'ROLL_80',
  name:'80mm 小票',
  kind:'ROLL',
  unit:'mm',
  widthMm:80,
  heightMm:null,
  orientation:'PORTRAIT',
  heightMode:'AUTO',
  scaleMode:'FIT',
  dpi:203,
  margins:{top:4,right:3,bottom:5,left:3},
  autoHeight:{minMm:50,maxMm:1000,footerSpaceMm:5}
}

export const LABEL_70X40_PAPER:PaperModel={
  schemaVersion:1,
  id:'LABEL_70x40',
  name:'70×40mm 标签',
  kind:'LABEL',
  unit:'mm',
  widthMm:70,
  heightMm:40,
  orientation:'PORTRAIT',
  heightMode:'FIXED',
  scaleMode:'FIT',
  dpi:203,
  margins:{top:2,right:2,bottom:2,left:2},
  label:{mode:'SINGLE',columns:1,rows:1,gapXmm:0,gapYmm:0}
}

export const PAPER_PRESETS={
  A4:A4_PAPER,
  ROLL_80:ROLL_80_PAPER,
  LABEL_70x40:LABEL_70X40_PAPER
} as const

export function validatePaperModel(paper:PaperModel):PaperValidationResult{
  const errors:string[]=[]
  const warnings:string[]=[]
  if(paper.schemaVersion!==1)errors.push('paper.schemaVersion 必须为 1')
  if(!paper.id.trim())errors.push('paper.id 不能为空')
  if(paper.unit!=='mm')errors.push('当前只支持 mm')
  if(!Number.isFinite(paper.widthMm)||paper.widthMm<=0)errors.push('paper.widthMm 必须大于 0')
  if(paper.widthMm>1000)errors.push('paper.widthMm 不能超过 1000mm')
  if(paper.heightMm!==null&&(!Number.isFinite(paper.heightMm)||paper.heightMm<=0))errors.push('paper.heightMm 必须大于 0 或为 null')
  if(paper.heightMm!==null&&paper.heightMm>2000)errors.push('paper.heightMm 不能超过 2000mm')
  if(!Number.isFinite(paper.dpi)||paper.dpi<72||paper.dpi>1200)errors.push('paper.dpi 必须在 72~1200 之间')

  for(const [key,value] of Object.entries(paper.margins)){
    if(!Number.isFinite(value)||value<0)errors.push(`paper.margins.${key} 不能小于 0`)
  }

  if(paper.kind==='STANDARD'){
    if(paper.heightMode!=='FIXED')errors.push('STANDARD 必须使用 FIXED 高度')
    if(paper.heightMm===null)errors.push('STANDARD 必须提供固定高度')
    if(paper.autoHeight)warnings.push('STANDARD 会忽略 autoHeight')
  }

  if(paper.kind==='ROLL'){
    if(paper.heightMode!=='AUTO')errors.push('ROLL 必须使用 AUTO 高度')
    if(paper.heightMm!==null)errors.push('ROLL 的 heightMm 必须为 null')
    if(!paper.autoHeight){
      errors.push('ROLL 必须配置 autoHeight')
    }else{
      if(paper.autoHeight.minMm<20)errors.push('ROLL autoHeight.minMm 不能小于 20')
      if(paper.autoHeight.maxMm<=paper.autoHeight.minMm)errors.push('ROLL autoHeight.maxMm 必须大于 minMm')
      if(paper.autoHeight.maxMm>3000)errors.push('ROLL autoHeight.maxMm 不能超过 3000')
      if(paper.autoHeight.footerSpaceMm<0)errors.push('ROLL footerSpaceMm 不能小于 0')
    }
    if(paper.orientation!=='PORTRAIT')errors.push('ROLL 只支持 PORTRAIT')
  }

  if(paper.kind==='LABEL'){
    if(paper.heightMode!=='FIXED')errors.push('LABEL 必须使用 FIXED 高度')
    if(paper.heightMm===null)errors.push('LABEL 必须提供固定高度')
    if(!paper.label){
      errors.push('LABEL 必须配置 label 布局')
    }else{
      if(!Number.isInteger(paper.label.columns)||paper.label.columns<1)errors.push('label.columns 必须是 >= 1 的整数')
      if(!Number.isInteger(paper.label.rows)||paper.label.rows<1)errors.push('label.rows 必须是 >= 1 的整数')
      if(paper.label.gapXmm<0||paper.label.gapYmm<0)errors.push('label gap 不能小于 0')
    }
  }

  const physicalHeight=paper.heightMm??paper.autoHeight?.maxMm??0
  if(paper.margins.left+paper.margins.right>=paper.widthMm)errors.push('左右边距之和必须小于纸张宽度')
  if(physicalHeight>0&&paper.margins.top+paper.margins.bottom>=physicalHeight)errors.push('上下边距之和必须小于纸张高度')

  return {valid:errors.length===0,errors,warnings}
}

export function paperCssSize(model:PaperModel,resolvedAutoHeightMm?:number){
  const rawWidth=model.widthMm
  const rawHeight=model.heightMode==='AUTO'
    ?Math.max(model.autoHeight?.minMm??20,Math.min(resolvedAutoHeightMm??model.autoHeight?.minMm??20,model.autoHeight?.maxMm??3000))
    :(model.heightMm??0)
  const landscape=model.orientation==='LANDSCAPE'&&model.kind==='STANDARD'
  const widthMm=landscape?rawHeight:rawWidth
  const heightMm=landscape?rawWidth:rawHeight
  return {
    widthMm,
    heightMm,
    widthPx:widthMm*CSS_PX_PER_MM,
    heightPx:heightMm*CSS_PX_PER_MM
  }
}

export function calculatePreviewScale(
  model:PaperModel,
  viewportWidthPx:number,
  resolvedAutoHeightMm?:number,
  options:PreviewScaleOptions={}
):number{
  const size=paperCssSize(model,resolvedAutoHeightMm)
  const available=Math.max(1,viewportWidthPx-2*(options.paddingPx??24))
  const fit=available/Math.max(1,size.widthPx)
  const defaultMax=model.kind==='LABEL'?2.2:model.kind==='ROLL'?1.6:1
  const max=options.maxScale??defaultMax
  const min=options.minScale??0.2
  if(model.scaleMode==='ACTUAL')return 1
  const scaled=options.allowUpscale===false?Math.min(1,fit):fit
  return Math.max(min,Math.min(max,scaled))
}

export interface TemplatePaperLike{
  size?:string
  width:number
  height:number
  orientation?:PaperOrientation
  marginTop?:number
  marginRight?:number
  marginBottom?:number
  marginLeft?:number
  dpi?:number
  autoHeight?:boolean
  autoHeightMaxMm?:number
  paperType?:PaperKind
  heightMode?:PaperHeightMode
  scaleMode?:PaperScaleMode
  schemaVersion?:number
}

export function paperModelFromTemplatePaper(paper:TemplatePaperLike):PaperModel{
  const explicit=paper.paperType
  const size=(paper.size||'').toUpperCase()
  const kind:PaperKind=explicit??(paper.autoHeight||size.startsWith('ROLL')?'ROLL':size.startsWith('LABEL')?'LABEL':'STANDARD')
  const heightMode:PaperHeightMode=paper.heightMode??(kind==='ROLL'||paper.autoHeight?'AUTO':'FIXED')
  const id=paper.size||(
    kind==='ROLL'?`ROLL_${Math.round(paper.width)}`:
    kind==='LABEL'?`LABEL_${Math.round(paper.width)}x${Math.round(paper.height)}`:
    'CUSTOM'
  )
  return {
    schemaVersion:1,
    id,
    name:id,
    kind,
    unit:'mm',
    widthMm:paper.width,
    heightMm:heightMode==='AUTO'?null:paper.height,
    orientation:paper.orientation||'PORTRAIT',
    heightMode,
    scaleMode:paper.scaleMode??'FIT',
    dpi:paper.dpi||96,
    margins:{
      top:paper.marginTop??0,
      right:paper.marginRight??0,
      bottom:paper.marginBottom??0,
      left:paper.marginLeft??0
    },
    autoHeight:heightMode==='AUTO'?{
      minMm:Math.max(20,Math.min(paper.height||50,paper.autoHeightMaxMm||1000)),
      maxMm:paper.autoHeightMaxMm||1000,
      footerSpaceMm:paper.marginBottom??5
    }:undefined,
    label:kind==='LABEL'?{mode:'SINGLE',columns:1,rows:1,gapXmm:0,gapYmm:0}:undefined
  }
}
