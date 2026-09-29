export type TemplateElementType =
  | 'TEXT' | 'LONG_TEXT' | 'TITLE' | 'IMAGE' | 'LINE' | 'RECT' | 'TABLE'
  | 'BARCODE' | 'QRCODE' | 'DATE' | 'PAGE' | 'AMOUNT' | 'HEADER' | 'FOOTER' | 'WATERMARK'

export type HorizontalAlign='left'|'center'|'right'
export type VerticalAlign='top'|'middle'|'bottom'

export interface ElementStyle {
  fontFamily:string
  fontWeight:string
  fontStyle:string
  textDecoration:string
  color:string
  background:string
  borderColor:string
  borderWidth:number
  textAlign:HorizontalAlign
  verticalAlign:VerticalAlign
  opacity:number
  rotation:number
}

export interface TableColumn {
  key:string
  label:string
  width:number
  align:HorizontalAlign
  aggregate?:'SUM'|'COUNT'|'AVG'|'NONE'
  format?:'TEXT'|'NUMBER'|'CURRENCY'|'DATE'
  hidden?:boolean
}

export interface TableConfig {
  columns:TableColumn[]
  headerRows?:unknown[]
  merges?:unknown[]
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

export interface TemplatePaper {
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
}

export interface TemplateElement {
  id:string
  type:TemplateElementType
  x:number
  y:number
  w:number
  h:number
  text:string
  binding?:string
  visible:boolean
  locked:boolean
  fontSize:number
  zIndex:number
  src?:string
  barcodeFormat?:string
  style:ElementStyle
  table?:TableConfig
}

export interface TemplateDesign {
  paper:TemplatePaper
  grid:boolean
  snap:boolean
  elements:TemplateElement[]
  referenceImage?:unknown
  ai?:unknown
}

export interface ElementFrame {
  x:number
  y:number
  w:number
  h:number
}

export const defaultStyle=():ElementStyle=>({
  fontFamily:'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  fontWeight:'400',
  fontStyle:'normal',
  textDecoration:'none',
  color:'#17365f',
  background:'transparent',
  borderColor:'#9db3c4',
  borderWidth:0,
  textAlign:'left',
  verticalAlign:'middle',
  opacity:1,
  rotation:0,
})

export const defaultTable=():TableConfig=>({
  columns:[
    {key:'name',label:'项目',width:80,align:'left',aggregate:'NONE',format:'TEXT'},
    {key:'qty',label:'数量',width:35,align:'center',aggregate:'SUM',format:'NUMBER'},
    {key:'amount',label:'金额',width:55,align:'right',aggregate:'SUM',format:'CURRENCY'},
  ],
  headerRows:[],
  merges:[],
  rowHeight:7,
  pageRows:18,
  repeatHeader:true,
  hideWhenEmpty:false,
  fixedTotal:true,
  showPageSubtotal:false,
  groupBy:'',
  subtotalFields:[],
  totalFields:['amount'],
  showGrandTotal:true,
})

const numberValue=(value:unknown,fallback:number)=>{
  const parsed=Number(value)
  return Number.isFinite(parsed)?parsed:fallback
}
const stringValue=(value:unknown,fallback:string)=>typeof value==='string'?value:fallback
const booleanValue=(value:unknown,fallback:boolean)=>typeof value==='boolean'?value:fallback
const objectValue=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}

export function paperSize(paper:TemplatePaper){
  return paper.orientation==='LANDSCAPE'
    ? {width:paper.height,height:paper.width}
    : {width:paper.width,height:paper.height}
}

export function normalizeDesign(input:unknown):TemplateDesign{
  const source=objectValue(input)
  const paperSource=objectValue(source.paper)
  const rawOrientation=paperSource.orientation
  const paper:TemplatePaper={
    size:stringValue(paperSource.size,'A4'),
    width:Math.max(20,numberValue(paperSource.width,210)),
    height:Math.max(20,numberValue(paperSource.height,297)),
    orientation:rawOrientation==='LANDSCAPE'?'LANDSCAPE':'PORTRAIT',
    marginTop:Math.max(0,numberValue(paperSource.marginTop,10)),
    marginRight:Math.max(0,numberValue(paperSource.marginRight,10)),
    marginBottom:Math.max(0,numberValue(paperSource.marginBottom,10)),
    marginLeft:Math.max(0,numberValue(paperSource.marginLeft,10)),
    dpi:Math.max(72,numberValue(paperSource.dpi,96)),
    autoHeight:booleanValue(paperSource.autoHeight,false),
    autoHeightMaxMm:Math.max(30,numberValue(paperSource.autoHeightMaxMm,1000)),
  }

  const elementsSource=Array.isArray(source.elements)?source.elements:[]
  const elements=elementsSource.map((raw,index):TemplateElement=>{
    const item=objectValue(raw)
    const type=normalizeElementType(item.type)
    const styleSource=objectValue(item.style)
    const styleDefault=defaultStyle()
    const style:ElementStyle={
      fontFamily:stringValue(styleSource.fontFamily,styleDefault.fontFamily),
      fontWeight:stringValue(styleSource.fontWeight,styleDefault.fontWeight),
      fontStyle:stringValue(styleSource.fontStyle,styleDefault.fontStyle),
      textDecoration:stringValue(styleSource.textDecoration,styleDefault.textDecoration),
      color:stringValue(styleSource.color,styleDefault.color),
      background:stringValue(styleSource.background,styleDefault.background),
      borderColor:stringValue(styleSource.borderColor,styleDefault.borderColor),
      borderWidth:Math.max(0,numberValue(styleSource.borderWidth,styleDefault.borderWidth)),
      textAlign:normalizeHorizontal(styleSource.textAlign),
      verticalAlign:normalizeVertical(styleSource.verticalAlign),
      opacity:Math.max(0,Math.min(1,numberValue(styleSource.opacity,1))),
      rotation:numberValue(styleSource.rotation,0),
    }
    const tableSource=objectValue(item.table)
    const table=type==='TABLE'?normalizeTable(tableSource):undefined

    return {
      id:stringValue(item.id,'el-'+(index+1)),
      type,
      x:Math.max(0,numberValue(item.x,20)),
      y:Math.max(0,numberValue(item.y,20)),
      w:Math.max(2,numberValue(item.w,60)),
      h:Math.max(2,numberValue(item.h,14)),
      text:stringValue(item.text,''),
      visible:booleanValue(item.visible,true),
      locked:booleanValue(item.locked,false),
      fontSize:Math.max(6,numberValue(item.fontSize,12)),
      zIndex:Math.max(1,numberValue(item.zIndex,index+1)),
      style,
      ...(typeof item.binding==='string'?{binding:item.binding}:{}),
      ...(typeof item.src==='string'?{src:item.src}:{}),
      ...(typeof item.barcodeFormat==='string'?{barcodeFormat:item.barcodeFormat}:{}),
      ...(table?{table}:{}),
    }
  })

  return {
    paper,
    grid:booleanValue(source.grid,true),
    snap:booleanValue(source.snap,true),
    elements,
    referenceImage:source.referenceImage,
    ai:source.ai,
  }
}

function normalizeTable(source:Record<string,unknown>):TableConfig{
  const fallback=defaultTable()
  const columnsSource=Array.isArray(source.columns)?source.columns:[]
  const columns=columnsSource.length?columnsSource.map((raw,index)=>{
    const item=objectValue(raw)
    return {
      key:stringValue(item.key,'column-'+index),
      label:stringValue(item.label,'字段'),
      width:Math.max(10,numberValue(item.width,50)),
      align:normalizeHorizontal(item.align),
      aggregate:normalizeAggregate(item.aggregate),
      format:normalizeFormat(item.format),
      hidden:booleanValue(item.hidden,false),
    } satisfies TableColumn
  }):fallback.columns

  return {
    ...fallback,
    ...source,
    columns,
    rowHeight:Math.max(3,numberValue(source.rowHeight,fallback.rowHeight)),
    pageRows:Math.max(1,Math.round(numberValue(source.pageRows,fallback.pageRows))),
    repeatHeader:booleanValue(source.repeatHeader,fallback.repeatHeader),
    hideWhenEmpty:booleanValue(source.hideWhenEmpty,fallback.hideWhenEmpty),
    fixedTotal:booleanValue(source.fixedTotal,fallback.fixedTotal),
    showGrandTotal:booleanValue(source.showGrandTotal,fallback.showGrandTotal),
  } as TableConfig
}

function normalizeElementType(value:unknown):TemplateElementType{
  const types:TemplateElementType[]=['TEXT','LONG_TEXT','TITLE','IMAGE','LINE','RECT','TABLE','BARCODE','QRCODE','DATE','PAGE','AMOUNT','HEADER','FOOTER','WATERMARK']
  return typeof value==='string'&&types.includes(value as TemplateElementType)?value as TemplateElementType:'TEXT'
}
function normalizeHorizontal(value:unknown):HorizontalAlign{
  return value==='center'||value==='right'?value:'left'
}
function normalizeVertical(value:unknown):VerticalAlign{
  return value==='top'||value==='bottom'?value:'middle'
}
function normalizeAggregate(value:unknown):NonNullable<TableColumn['aggregate']>{
  return value==='SUM'||value==='COUNT'||value==='AVG'||value==='NONE'?value:'NONE'
}
function normalizeFormat(value:unknown):NonNullable<TableColumn['format']>{
  return value==='NUMBER'||value==='CURRENCY'||value==='DATE'||value==='TEXT'?value:'TEXT'
}

export function createElement(type:TemplateElementType,index:number,x=20,y=20):TemplateElement{
  const texts:Record<TemplateElementType,string>={
    TEXT:'文本',
    LONG_TEXT:'这里是一段长文本',
    TITLE:'标题',
    IMAGE:'图片',
    LINE:'',
    RECT:'',
    TABLE:'明细表',
    BARCODE:'1234567890',
    QRCODE:'https://example.com',
    DATE:'{{date}}',
    PAGE:'第 {{page}} / {{pages}} 页',
    AMOUNT:'￥{{amount}}',
    HEADER:'页眉',
    FOOTER:'页脚',
    WATERMARK:'水印',
  }
  const style=defaultStyle()
  let w=60
  let h=14
  let fontSize=12
  if(type==='TABLE'){w=170;h=145}
  if(type==='LINE'){w=80;h=2}
  if(type==='QRCODE'){w=28;h=28}
  if(type==='RECT'){w=60;h=35;style.borderWidth=1}
  if(type==='IMAGE'){w=55;h=40}
  if(type==='BARCODE'){w=60;h=24}
  if(type==='TITLE'){fontSize=18;style.fontWeight='700';style.textAlign='center'}
  if(type==='WATERMARK'){w=110;h=24;fontSize=28;style.opacity=.16;style.rotation=-28;style.textAlign='center'}
  if(type==='HEADER'||type==='FOOTER'){w=170;h=8;fontSize=9;style.textAlign='center'}

  return {
    id:'el-'+Date.now()+'-'+index,
    type,
    x,
    y,
    w,
    h,
    text:texts[type],
    binding:type==='TABLE'?'items':'',
    visible:true,
    locked:false,
    fontSize,
    zIndex:index,
    style,
    ...(type==='TABLE'?{table:defaultTable()}:{}),
    ...(type==='BARCODE'?{barcodeFormat:'CODE128'}:{}),
  }
}

export const elementTypeLabel:Record<TemplateElementType,string>={
  TEXT:'文本',
  LONG_TEXT:'长文本',
  TITLE:'标题',
  IMAGE:'图片',
  LINE:'线条',
  RECT:'矩形',
  TABLE:'动态表格',
  BARCODE:'条码',
  QRCODE:'二维码',
  DATE:'日期',
  PAGE:'页码',
  AMOUNT:'金额',
  HEADER:'页眉',
  FOOTER:'页脚',
  WATERMARK:'水印',
}
