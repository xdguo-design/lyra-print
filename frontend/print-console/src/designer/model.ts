import { toRaw } from 'vue'
import type {
  ElementStyle,TableConfig,TableColumn,TemplateDesign,TemplateElement,TemplateElementType
} from '../types'

export const defaultStyle=():ElementStyle=>({
  fontFamily:'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  fontWeight:'400',fontStyle:'normal',textDecoration:'none',
  color:'#17365f',background:'transparent',borderColor:'#9db3c4',borderWidth:0,
  textAlign:'left',verticalAlign:'middle',opacity:1,rotation:0
})

export const defaultTable=():TableConfig=>({
  columns:[
    {key:'name',label:'项目',width:80,align:'left',aggregate:'NONE',format:'TEXT'},
    {key:'qty',label:'数量',width:35,align:'center',aggregate:'SUM',format:'NUMBER'},
    {key:'amount',label:'金额',width:55,align:'right',aggregate:'SUM',format:'CURRENCY'}
  ],
  headerRows:[],merges:[],rowHeight:7,pageRows:18,repeatHeader:true,hideWhenEmpty:false,
  fixedTotal:true,showPageSubtotal:false,groupBy:'',subtotalFields:[],totalFields:['amount'],showGrandTotal:true
})

export function normalizeDesign(design:TemplateDesign):TemplateDesign{
  const copy=structuredClone(toRaw(design) as TemplateDesign)
  copy.paper.dpi=copy.paper.dpi||96
  copy.elements=copy.elements.map((el,index)=>({
    ...el,
    style:{...defaultStyle(),...(el.style||{})},
    table:el.type==='TABLE'?{...defaultTable(),...(el.table||{}),columns:(el.table?.columns?.length?el.table.columns:defaultTable().columns)}:el.table,
    zIndex:el.zIndex||index+1
  }))
  return copy
}

export function createElement(type:TemplateElementType,index:number,x=20,y=20):TemplateElement{
  const texts:Record<TemplateElementType,string>={
    TEXT:'文本',LONG_TEXT:'这里是一段长文本',TITLE:'标题',IMAGE:'图片',LINE:'',RECT:'',
    TABLE:'明细表',BARCODE:'1234567890',QRCODE:'https://example.com',DATE:'{{date}}',
    PAGE:'第 {{page}} / {{pages}} 页',AMOUNT:'￥{{amount}}',HEADER:'页眉',FOOTER:'页脚',WATERMARK:'水印'
  }
  const style=defaultStyle()
  let w=60,h=14,fontSize=12
  if(type==='TABLE'){w=170;h=145}
  if(type==='LINE'){w=80;h=2;style.borderWidth=0}
  if(type==='QRCODE'){w=28;h=28}
  if(type==='RECT'){w=60;h=35;style.borderWidth=1}
  if(type==='TITLE'){fontSize=18;style.fontWeight='700';style.textAlign='center'}
  if(type==='WATERMARK'){w=110;h=24;fontSize=28;style.opacity=.16;style.rotation=-28;style.textAlign='center'}
  if(type==='HEADER'||type==='FOOTER'){w=170;h=8;fontSize=9;style.textAlign='center'}
  return {
    id:'el-'+Date.now()+'-'+index,type,x,y,w,h,text:texts[type],
    binding:type==='TABLE'?'items':'',visible:true,locked:false,fontSize,zIndex:index,style,
    table:type==='TABLE'?defaultTable():undefined,barcodeFormat:type==='BARCODE'?'CODE128':undefined
  }
}

export function resolvePath(data:unknown,path?:string):unknown{
  if(!path)return undefined
  let current:any=data
  for(const part of path.split('.')){if(current==null)return undefined;current=current[part]}
  return current
}
export function renderText(text:string,data:Record<string,unknown>):string{
  return text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*}}/g,(_m,path)=>{const value=resolvePath(data,path);return value==null?'{{'+path+'}}':String(value)})
}
export function formatValue(value:unknown,column?:TableColumn):string{
  if(value==null)return ''
  if(column?.format==='CURRENCY'){const n=Number(value);return Number.isFinite(n)?n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):String(value)}
  if(column?.format==='NUMBER'){const n=Number(value);return Number.isFinite(n)?n.toLocaleString('zh-CN'):String(value)}
  if(column?.format==='DATE'){const date=new Date(String(value));return Number.isNaN(date.getTime())?String(value):date.toLocaleDateString('zh-CN')}
  return String(value)
}
export function tableRows(el:TemplateElement,data:Record<string,unknown>):Record<string,unknown>[]{
  const value=resolvePath(data,el.binding||'items');return Array.isArray(value)?value as Record<string,unknown>[]:[]
}
export function aggregate(rows:Record<string,unknown>[],field:string,kind='SUM'):number{
  if(kind==='COUNT')return rows.length
  const nums=rows.map(r=>Number(resolvePath(r,field))).filter(Number.isFinite)
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
  const ordered=[...elements].sort((a,b)=>a.y-b.y||a.zIndex-b.zIndex)
  const result:TemplateElement[]=[]
  let shift=0
  let maxBottom=0

  for(const original of ordered){
    const el=structuredClone(toRaw(original) as TemplateElement)
    el.y=original.y+shift

    if(el.type==='TABLE'&&el.table){
      const rows=tableRows(el,data)
      const rowHeight=Math.max(3,el.table.rowHeight||6)
      const headerRows=(el.table.headerRows?.length||0)+1
      let groupRows=0
      if(el.table.groupBy){
        let last:string|undefined
        for(const row of rows){
          const key=String(resolvePath(row,el.table.groupBy)??'未分组')
          if(key!==last){groupRows+=2;last=key}
        }
      }
      const totalRows=(el.table.showGrandTotal?1:0)+(el.table.showPageSubtotal?1:0)
      const contentHeight=Math.max(
        rowHeight*3,
        (headerRows+rows.length+groupRows+totalRows)*rowHeight
      )
      const growth=Math.max(0,contentHeight-original.h)
      el.h=Math.max(original.h,contentHeight)
      shift+=growth
    }

    maxBottom=Math.max(maxBottom,el.y+el.h)
    result.push(el)
  }

  const height=Math.min(Math.max(30,maxBottom+Math.max(0,marginBottom)),Math.max(30,maxHeightMm))
  return {elements:result,height}
}

