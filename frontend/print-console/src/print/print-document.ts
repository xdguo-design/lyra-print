export const PRINT_CSS=[
  '@page{margin:0}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:white;font-family:Arial,"Microsoft YaHei",sans-serif}',
  '.print-page{position:relative;page-break-after:always;break-after:page;overflow:hidden;background:#fff}',
  '.print-page:last-child{page-break-after:auto;break-after:auto}',
  '.dynamic-table{width:100%;border-collapse:collapse;table-layout:fixed}',
  '.dynamic-table th,.dynamic-table td{border:1px solid currentColor;padding:1mm;overflow:hidden;word-break:break-all}',
  '.dynamic-table thead th{font-weight:600;background:#eef5f9}',
  '.group-row td,.subtotal-row td,.dynamic-table tfoot td,.fixed-total-table td{font-weight:600;background:#f4f8fb}',
  '.page-subtotal-row td{background:#e8f2fa}',
  '.table-shell{position:relative;width:100%;height:100%;overflow:hidden}',
  '.fixed-total-table{position:absolute;left:0;right:0;bottom:0;background:#fff}',
  'img{max-width:100%;max-height:100%}',
  '.preview-reference{display:none}'
].join('')


export function parsePageRange(value:string,totalPages:number):number[]{
  const total=Math.max(0,Math.floor(totalPages))
  const raw=value.trim()
  if(!raw)return Array.from({length:total},(_,i)=>i+1)
  const pages=new Set<number>()
  for(const token of raw.split(',').map(x=>x.trim()).filter(Boolean)){
    if(/^\d+$/.test(token)){
      const page=Number(token)
      if(page<1||page>total)throw new Error('页码超出范围: '+token)
      pages.add(page)
      continue
    }
    const match=token.match(/^(\d+)\s*-\s*(\d+)$/)
    if(!match)throw new Error('页范围格式错误: '+token)
    const start=Number(match[1]),end=Number(match[2])
    if(start<1||end<1||start>total||end>total||start>end)throw new Error('页范围超出范围: '+token)
    for(let page=start;page<=end;page++)pages.add(page)
  }
  if(!pages.size)throw new Error('至少选择一页')
  return [...pages].sort((a,b)=>a-b)
}

export type PrintPageSize={width:number;height:number}
export type PrintCalibration={offsetXmm:number;offsetYmm:number;scalePercent:number}

function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]||char))
}

export function buildPrintDocument(title:string,bodyHtml:string,pageSize?:PrintPageSize,calibration?:PrintCalibration){
  const sizeRule=pageSize?'@page{size:'+pageSize.width+'mm '+pageSize.height+'mm}':''
  const offsetX=calibration?.offsetXmm??0,offsetY=calibration?.offsetYmm??0
  const scale=Math.max(.8,Math.min(1.2,(calibration?.scalePercent??100)/100))
  const calibrationRule=(offsetX||offsetY||scale!==1)
    ?'.print-page{transform:translate('+offsetX+'mm,'+offsetY+'mm) scale('+scale+');transform-origin:top left}'
    :''
  return '<!doctype html><html><head><meta charset="utf-8"><title>'+
    escapeHtml(title)+'</title><style>'+PRINT_CSS+sizeRule+calibrationRule+
    '</style></head><body>'+bodyHtml+'</body></html>'
}

export type PrintWindowLike={
  document:{write:(html:string)=>void;close:()=>void}
  focus:()=>void
  print:()=>void
}
export type PrintWindowOpener=(url?:string,target?:string,features?:string)=>PrintWindowLike|null

export function openPrintDocument(
  title:string,
  bodyHtml:string,
  opener:PrintWindowOpener=(url,target,features)=>window.open(url,target,features) as unknown as PrintWindowLike|null,
  schedule:(callback:()=>void,delay:number)=>unknown=(callback,delay)=>setTimeout(callback,delay),
  pageSize?:PrintPageSize,
  calibration?:PrintCalibration
){
  const win=opener('','_blank','width=1100,height=850')
  if(!win)return false
  win.document.write(buildPrintDocument(title,bodyHtml,pageSize,calibration))
  win.document.close()
  win.focus()
  schedule(()=>win.print(),350)
  return true
}
