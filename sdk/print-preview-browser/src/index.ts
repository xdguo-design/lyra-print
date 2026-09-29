export * from './paper'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

export type HorizontalAlign='left'|'center'|'right'
export type VerticalAlign='top'|'middle'|'bottom'

export interface ElementStyle{
  fontFamily?:string
  fontWeight?:string
  fontStyle?:string
  textDecoration?:string
  color?:string
  background?:string
  borderColor?:string
  borderWidth?:number
  textAlign?:HorizontalAlign
  verticalAlign?:VerticalAlign
  opacity?:number
  rotation?:number
}

export interface TableColumn{
  key:string
  label:string
  width:number
  align:HorizontalAlign
  aggregate?:'SUM'|'COUNT'|'AVG'|'NONE'
  format?:'TEXT'|'NUMBER'|'CURRENCY'|'DATE'
  hidden?:boolean
}
export interface TableHeaderCell{text:string;colSpan:number;rowSpan:number;startColumn:number}
export interface TableHeaderRow{cells:TableHeaderCell[]}
export interface TableMerge{row:number;column:number;rowSpan:number;colSpan:number}
export interface TableConfig{
  columns:TableColumn[]
  headerRows?:TableHeaderRow[]
  merges?:TableMerge[]
  rowHeight:number
  pageRows:number
  repeatHeader:boolean
  hideWhenEmpty:boolean
  fixedTotal:boolean
  showPageSubtotal?:boolean
  groupBy?:string
  subtotalFields?:string[]
  totalFields?:string[]
  showGrandTotal:boolean
}

export interface TemplatePaper{
  size:string
  width:number
  height:number
  orientation:'PORTRAIT'|'LANDSCAPE'
  marginTop:number
  marginRight:number
  marginBottom:number
  marginLeft:number
  dpi?:number
  autoHeight?:boolean
  autoHeightMaxMm?:number
  paperType?:'STANDARD'|'ROLL'|'LABEL'
  heightMode?:'FIXED'|'AUTO'
  scaleMode?:'FIT'|'ACTUAL'
  schemaVersion?:number
}

export interface TemplateElement{
  id:string
  type:string
  x:number;y:number;w:number;h:number
  text:string
  binding?:string
  visible:boolean
  locked?:boolean
  fontSize:number
  zIndex:number
  src?:string
  barcodeFormat?:string
  style?:ElementStyle
  table?:TableConfig
}

export interface TemplateDesign{
  paper:TemplatePaper
  grid?:boolean
  snap?:boolean
  elements:TemplateElement[]
}

export interface PreviewPayload{
  templateName:string
  design:TemplateDesign|Record<string,unknown>
  renderData:Record<string,unknown>
}

export interface PreviewRenderResult{
  html:string
  printHtml:string
  bodyHtml:string
  pageCount:number
  pageSize:{width:number;height:number}
}

export interface MountPreviewOptions{
  className?:string
  title?:string
  height?:string
  background?:string
}

export const PRINT_CSS=[
  '@page{margin:0}',
  '*{box-sizing:border-box}',
  'html,body{margin:0;padding:0;background:white;font-family:Arial,"Microsoft YaHei",sans-serif}',
  '.print-pages{display:grid;gap:0;justify-content:center}',
  '.print-page{position:relative;page-break-after:always;break-after:page;overflow:hidden;background:#fff}',
  '.print-page:last-child{page-break-after:auto;break-after:auto}',
  '.preview-element{box-sizing:border-box}',
  '.dynamic-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:inherit;color:inherit;background:inherit}',
  '.dynamic-table th,.dynamic-table td{border:1px solid currentColor;padding:1mm;overflow:hidden;word-break:break-all}',
  '.dynamic-table thead th{font-weight:600;background:rgba(230,240,248,.65)}',
  '.group-row td{font-weight:600;background:rgba(220,236,248,.65)}',
  '.subtotal-row td,.dynamic-table tfoot td,.fixed-total-table td{font-weight:600;background:rgba(242,247,250,.95)}',
  '.page-subtotal-row td{background:rgba(232,242,250,.95)}',
  '.table-shell{position:relative;width:100%;height:100%;overflow:hidden}',
  '.fixed-total-table{position:absolute;left:0;right:0;bottom:0;background:#fff}',
  '.element-image{width:100%;height:100%;display:block;object-fit:contain}',
  '.code-image{width:100%;height:100%;display:block;object-fit:contain}',
  '.code-error{font-size:10px;color:#c34d4d}',
  'img{max-width:100%;max-height:100%}'
].join('')

function escapeHtml(value:unknown):string{
  return String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]||char))
}

function escapeAttr(value:unknown):string{
  return escapeHtml(value).replace(/\r?\n/g,'&#10;')
}

function cssValue(value:unknown):string{
  return String(value??'').replace(/[;{}]/g,'')
}

export function resolvePath(data:unknown,path?:string):unknown{
  if(!path)return undefined
  let current:any=data
  for(const part of path.split('.')){
    if(current==null)return undefined
    current=current[part]
  }
  return current
}

export function renderText(text:string,data:Record<string,unknown>):string{
  return text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*}}/g,(_match,path)=>{
    const value=resolvePath(data,path)
    return value==null?'{{'+path+'}}':String(value)
  })
}

export function formatValue(value:unknown,column?:TableColumn):string{
  if(value==null)return ''
  if(column?.format==='CURRENCY'){
    const n=Number(value)
    return Number.isFinite(n)?n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):String(value)
  }
  if(column?.format==='NUMBER'){
    const n=Number(value)
    return Number.isFinite(n)?n.toLocaleString('zh-CN'):String(value)
  }
  if(column?.format==='DATE'){
    const date=new Date(String(value))
    return Number.isNaN(date.getTime())?String(value):date.toLocaleDateString('zh-CN')
  }
  return String(value)
}

export function tableRows(element:TemplateElement,data:Record<string,unknown>):Record<string,unknown>[]{
  const value=resolvePath(data,element.binding||'items')
  return Array.isArray(value)?value as Record<string,unknown>[]:[]
}

export function aggregate(rows:Record<string,unknown>[],field:string,kind='SUM'):number{
  if(kind==='COUNT')return rows.length
  const nums=rows.map(row=>Number(resolvePath(row,field))).filter(Number.isFinite)
  if(!nums.length)return 0
  if(kind==='AVG')return nums.reduce((a,b)=>a+b,0)/nums.length
  return nums.reduce((a,b)=>a+b,0)
}

export function paginateRows(rows:Record<string,unknown>[],config:TableConfig):Record<string,unknown>[][]{
  const size=Math.max(1,config.pageRows||18)
  if(!rows.length)return [[]]
  const pages:Record<string,unknown>[][]=[]
  for(let i=0;i<rows.length;i+=size)pages.push(rows.slice(i,i+size))
  return pages
}

export function adaptiveReceiptLayout(
  elements:TemplateElement[],
  data:Record<string,unknown>,
  marginBottom=5,
  maxHeightMm=1000
):{elements:TemplateElement[];height:number}{
  const ordered=elements.map(element=>structuredClone(element)).sort((a,b)=>a.y-b.y||a.zIndex-b.zIndex)
  const result:TemplateElement[]=[]
  let shift=0
  let maxBottom=0

  for(const original of ordered){
    const element=structuredClone(original)
    element.y=original.y+shift
    if(element.type==='TABLE'&&element.table){
      const rows=tableRows(element,data)
      const rowHeight=Math.max(3,element.table.rowHeight||6)
      const headerRows=(element.table.headerRows?.length||0)+1
      let groupRows=0
      if(element.table.groupBy){
        let last:string|undefined
        for(const row of rows){
          const key=String(resolvePath(row,element.table.groupBy)??'未分组')
          if(key!==last){groupRows+=2;last=key}
        }
      }
      const totalRows=(element.table.showGrandTotal?1:0)+(element.table.showPageSubtotal?1:0)
      const contentHeight=Math.max(rowHeight*3,(headerRows+rows.length+groupRows+totalRows)*rowHeight)
      const growth=Math.max(0,contentHeight-original.h)
      element.h=Math.max(original.h,contentHeight)
      shift+=growth
    }
    maxBottom=Math.max(maxBottom,element.y+element.h)
    result.push(element)
  }

  const height=Math.min(Math.max(30,maxBottom+Math.max(0,marginBottom)),Math.max(30,maxHeightMm))
  return {elements:result,height}
}

function pageSize(design:TemplateDesign,data:Record<string,unknown>){
  const paper=design.paper
  if(paper.autoHeight){
    const layout=adaptiveReceiptLayout(design.elements,data,paper.marginBottom,paper.autoHeightMaxMm||1000)
    return {width:paper.width,height:layout.height,elements:layout.elements}
  }
  const landscape=paper.orientation==='LANDSCAPE'
  return {
    width:landscape?paper.height:paper.width,
    height:landscape?paper.width:paper.height,
    elements:design.elements
  }
}

function pageCount(elements:TemplateElement[],data:Record<string,unknown>,autoHeight:boolean){
  if(autoHeight)return 1
  let count=1
  for(const element of elements){
    if(element.type!=='TABLE'||!element.table)continue
    count=Math.max(count,paginateRows(tableRows(element,data),element.table).length)
  }
  return count
}

function shouldRender(element:TemplateElement,pageIndex:number){
  if(['HEADER','FOOTER','WATERMARK','PAGE','TABLE'].includes(element.type))return true
  return pageIndex===0
}

function elementStyle(element:TemplateElement):string{
  const style=element.style||{}
  const justify=style.textAlign==='center'?'center':style.textAlign==='right'?'flex-end':'flex-start'
  const align=style.verticalAlign==='top'?'flex-start':style.verticalAlign==='bottom'?'flex-end':'center'
  const declarations=[
    'position:absolute',
    `left:${element.x}mm`,
    `top:${element.y}mm`,
    `width:${element.w}mm`,
    `height:${element.h}mm`,
    element.visible===false?'display:none':'display:flex',
    `align-items:${align}`,
    `justify-content:${justify}`,
    `font-family:${cssValue(style.fontFamily||'Arial,"Microsoft YaHei",sans-serif')}`,
    `font-size:${element.fontSize}pt`,
    `font-weight:${cssValue(style.fontWeight||'400')}`,
    `font-style:${cssValue(style.fontStyle||'normal')}`,
    `text-decoration:${cssValue(style.textDecoration||'none')}`,
    `color:${cssValue(style.color||'#17365f')}`,
    `background:${cssValue(style.background||'transparent')}`,
    `border:${style.borderWidth||0}px solid ${cssValue(style.borderColor||'transparent')}`,
    `opacity:${style.opacity??1}`,
    `transform:rotate(${style.rotation||0}deg)`,
    'transform-origin:center center',
    'overflow:hidden',
    `z-index:${element.zIndex}`,
    'white-space:pre-wrap',
    `text-align:${cssValue(style.textAlign||'left')}`
  ]
  if(element.type==='LINE')declarations.push(`border-top:1px solid ${cssValue(style.borderColor||'#17365f')}`)
  return declarations.join(';')
}

function mergeAt(config:TableConfig,row:number,column:number){
  return config.merges?.find(merge=>merge.row===row&&merge.column===column)
}
function coveredByMerge(config:TableConfig,row:number,column:number){
  return config.merges?.some(merge=>
    row>=merge.row&&row<merge.row+merge.rowSpan&&
    column>=merge.column&&column<merge.column+merge.colSpan&&
    !(row===merge.row&&column===merge.column)
  )
}
function aggregateText(rows:Record<string,unknown>[],column:TableColumn){
  if(!column.aggregate||column.aggregate==='NONE')return ''
  return formatValue(aggregate(rows,column.key,column.aggregate),{
    ...column,
    format:column.aggregate==='COUNT'?'NUMBER':'CURRENCY'
  })
}

function renderTable(config:TableConfig,rows:Record<string,unknown>[],showGrandTotal:boolean,showHeader:boolean):string{
  if(!rows.length&&config.hideWhenEmpty)return '<div class="empty-table">空数据隐藏</div>'
  const columns=config.columns.filter(column=>!column.hidden)
  const colgroup='<colgroup>'+columns.map(column=>`<col style="width:${column.width}mm">`).join('')+'</colgroup>'
  let thead=''
  if(showHeader){
    const custom=(config.headerRows||[]).map(row=>
      '<tr>'+row.cells.map(cell=>`<th colspan="${cell.colSpan}" rowspan="${cell.rowSpan}">${escapeHtml(cell.text)}</th>`).join('')+'</tr>'
    ).join('')
    thead='<thead>'+custom+'<tr>'+columns.map(column=>
      `<th style="text-align:${column.align}">${escapeHtml(column.label)}</th>`
    ).join('')+'</tr></thead>'
  }

  let body=''
  const groupBy=config.groupBy?.trim()
  if(groupBy){
    let bucket:Record<string,unknown>[]=[]
    let current=''
    const flush=()=>{
      if(!bucket.length)return
      body+=`<tr class="group-row"><td colspan="${columns.length}">分组：${escapeHtml(current)}</td></tr>`
      bucket.forEach((row,rowIndex)=>{
        body+='<tr class="data-row">'+columns.map((column,columnIndex)=>{
          if(coveredByMerge(config,rowIndex,columnIndex))return ''
          const merge=mergeAt(config,rowIndex,columnIndex)
          return `<td rowspan="${merge?.rowSpan||1}" colspan="${merge?.colSpan||1}" style="text-align:${column.align};height:${config.rowHeight}mm">${escapeHtml(formatValue(resolvePath(row,column.key),column))}</td>`
        }).join('')+'</tr>'
      })
      body+='<tr class="subtotal-row">'+columns.map((column,index)=>
        `<td style="text-align:${column.align}">${index===0?'小计':escapeHtml(aggregateText(bucket,column))}</td>`
      ).join('')+'</tr>'
      bucket=[]
    }
    for(const row of rows){
      const key=String(resolvePath(row,groupBy)??'未分组')
      if(bucket.length&&key!==current)flush()
      current=key
      bucket.push(row)
    }
    flush()
  }else{
    body=rows.map((row,rowIndex)=>
      '<tr class="data-row">'+columns.map((column,columnIndex)=>{
        if(coveredByMerge(config,rowIndex,columnIndex))return ''
        const merge=mergeAt(config,rowIndex,columnIndex)
        return `<td rowspan="${merge?.rowSpan||1}" colspan="${merge?.colSpan||1}" style="text-align:${column.align};height:${config.rowHeight}mm">${escapeHtml(formatValue(resolvePath(row,column.key),column))}</td>`
      }).join('')+'</tr>'
    ).join('')
  }

  let tfoot=''
  if(rows.length&&(config.showPageSubtotal||(config.showGrandTotal&&showGrandTotal&&!config.fixedTotal))){
    const rowsHtml:string[]=[]
    if(config.showPageSubtotal)rowsHtml.push(
      '<tr class="page-subtotal-row">'+columns.map((column,index)=>
        `<td style="text-align:${column.align}">${index===0?'本页小计':escapeHtml(aggregateText(rows,column))}</td>`
      ).join('')+'</tr>'
    )
    if(config.showGrandTotal&&showGrandTotal&&!config.fixedTotal)rowsHtml.push(
      '<tr>'+columns.map((column,index)=>
        `<td style="text-align:${column.align}">${index===0?'总计':escapeHtml(aggregateText(rows,column))}</td>`
      ).join('')+'</tr>'
    )
    tfoot='<tfoot>'+rowsHtml.join('')+'</tfoot>'
  }

  let fixed=''
  if(config.fixedTotal&&config.showGrandTotal&&showGrandTotal&&rows.length){
    fixed='<table class="dynamic-table fixed-total-table">'+colgroup+'<tbody><tr>'+
      columns.map((column,index)=>
        `<td style="text-align:${column.align}">${index===0?'总计':escapeHtml(aggregateText(rows,column))}</td>`
      ).join('')+'</tr></tbody></table>'
  }
  return '<div class="table-shell"><table class="dynamic-table">'+colgroup+thead+'<tbody>'+body+'</tbody>'+tfoot+'</table>'+fixed+'</div>'
}

async function renderCode(element:TemplateElement,value:string):Promise<string>{
  if(!value)return '<span class="code-error">编码内容无效</span>'
  try{
    if(element.type==='QRCODE'){
      const src=await QRCode.toDataURL(value,{margin:0,width:320,errorCorrectionLevel:'M'})
      return `<img class="code-image" alt="QR code" src="${escapeAttr(src)}">`
    }
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
    JsBarcode(svg,value,{format:element.barcodeFormat||'CODE128',displayValue:false,margin:0,height:80,width:2})
    const serialized=new XMLSerializer().serializeToString(svg)
    const src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(serialized)
    return `<img class="code-image" alt="Barcode" src="${escapeAttr(src)}">`
  }catch{
    return '<span class="code-error">编码内容无效</span>'
  }
}

async function renderElement(
  element:TemplateElement,
  data:Record<string,unknown>,
  rowsOverride:Record<string,unknown>[]|undefined,
  page:number,
  pages:number,
  showGrandTotal:boolean,
  showHeader:boolean
):Promise<string>{
  const merged={...data,page,pages}
  const bound=element.binding?resolvePath(merged,element.binding):undefined
  const textValue=bound!=null&&element.type!=='TABLE'?String(bound):renderText(element.text||'',merged)
  if(element.type==='TABLE'&&element.table){
    return renderTable(element.table,rowsOverride||tableRows(element,data),showGrandTotal,showHeader)
  }
  if(element.type==='QRCODE'||element.type==='BARCODE')return renderCode(element,textValue)
  if(element.type==='IMAGE'&&element.src)return `<img class="element-image" alt="" src="${escapeAttr(element.src)}">`
  if(element.type==='IMAGE')return '<div class="image-empty"></div>'
  return `<span>${escapeHtml(textValue).replace(/\n/g,'<br>')}</span>`
}

export function buildPrintDocument(
  title:string,
  bodyHtml:string,
  pageSize:{width:number;height:number},
  calibration?:{offsetXmm:number;offsetYmm:number;scalePercent:number}
):string{
  const sizeRule=`@page{size:${pageSize.width}mm ${pageSize.height}mm}`
  const offsetX=calibration?.offsetXmm??0
  const offsetY=calibration?.offsetYmm??0
  const scale=Math.max(.8,Math.min(1.2,(calibration?.scalePercent??100)/100))
  const calibrationRule=(offsetX||offsetY||scale!==1)
    ?`.print-page{transform:translate(${offsetX}mm,${offsetY}mm) scale(${scale});transform-origin:top left}`
    :''
  return '<!doctype html><html><head><meta charset="utf-8"><title>'+
    escapeHtml(title)+'</title><style>'+PRINT_CSS+sizeRule+calibrationRule+
    '</style></head><body>'+bodyHtml+'</body></html>'
}

export async function renderPreview(payload:PreviewPayload):Promise<PreviewRenderResult>{
  const design=payload?.design as TemplateDesign
  if(!design?.paper||!Array.isArray(design.elements))throw new Error('Invalid template design')
  const data=payload.renderData||{}
  const size=pageSize(design,data)
  const elements=[...size.elements].filter(element=>element.visible!==false).sort((a,b)=>a.zIndex-b.zIndex)
  const total=pageCount(elements,data,Boolean(design.paper.autoHeight))
  const pages:string[]=[]

  for(let pageIndex=0;pageIndex<total;pageIndex++){
    const rendered:string[]=[]
    for(const element of elements){
      if(!shouldRender(element,pageIndex))continue
      let rows:Record<string,unknown>[]|undefined
      if(element.type==='TABLE'&&element.table){
        const all=tableRows(element,data)
        rows=design.paper.autoHeight?all:(paginateRows(all,element.table)[pageIndex]||[])
      }
      const inner=await renderElement(
        element,data,rows,pageIndex+1,total,pageIndex===total-1,
        element.type!=='TABLE'||!element.table||pageIndex===0||element.table.repeatHeader
      )
      rendered.push(`<div class="preview-element" data-element-id="${escapeAttr(element.id)}" style="${escapeAttr(elementStyle(element))}">${inner}</div>`)
    }
    pages.push(`<div class="print-page" data-page="${pageIndex+1}" style="width:${size.width}mm;height:${size.height}mm">${rendered.join('')}</div>`)
  }

  const bodyHtml='<div class="print-pages">'+pages.join('')+'</div>'
  const resolvedPageSize={width:size.width,height:size.height}
  const printHtml=buildPrintDocument(payload.templateName||'Print Preview',bodyHtml,resolvedPageSize)
  const sizeRule=`@page{size:${size.width}mm ${size.height}mm}`
  const title=escapeHtml(payload.templateName||'Print Preview')
  const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
    title+'</title><style>'+PRINT_CSS+sizeRule+
    'body{padding:16px;background:#dfe8ee}.print-pages{gap:18px}.print-page{box-shadow:0 8px 28px rgba(40,70,95,.2)}</style></head><body>'+
    bodyHtml+'</body></html>'
  return {html,printHtml,bodyHtml,pageCount:total,pageSize:resolvedPageSize}
}

export async function mountPreview(
  target:HTMLElement,
  payload:PreviewPayload,
  options:MountPreviewOptions={}
):Promise<{iframe:HTMLIFrameElement;result:PreviewRenderResult}>{
  const result=await renderPreview(payload)
  const iframe=document.createElement('iframe')
  iframe.title=options.title||payload.templateName||'Print Preview'
  iframe.className=options.className||'print-platform-preview'
  iframe.style.width='100%'
  iframe.style.height=options.height||'720px'
  iframe.style.border='0'
  iframe.style.background=options.background||'#dfe8ee'
  iframe.setAttribute('sandbox','allow-same-origin')
  iframe.srcdoc=result.html
  target.replaceChildren(iframe)
  return {iframe,result}
}
