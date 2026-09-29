export type DemoKind='A4'|'ROLL_80'|'LABEL_70x40'

export interface DemoScenario{
  id:DemoKind
  title:string
  subtitle:string
  templateCode:string
  paperText:string
  businessKeyPrefix:string
  inputData:Record<string,unknown>
}

const expenseItems=Array.from({length:27},(_,index)=>{
  const types=[
    {category:'诊察',itemCode:'110200001',itemName:'普通门诊诊察费',spec:'次',unit:'次',unitPrice:20},
    {category:'检查',itemCode:'310603001',itemName:'肺功能检查',spec:'常规',unit:'次',unitPrice:160},
    {category:'药品',itemCode:'YP-03218',itemName:'布地奈德吸入剂',spec:'1支/盒',unit:'支',unitPrice:86},
    {category:'治疗',itemCode:'ZL-01028',itemName:'雾化吸入治疗',spec:'次',unit:'次',unitPrice:36}
  ]
  const source=types[index%types.length]
  return {
    chargeTime:`${String(9+Math.floor(index/6)).padStart(2,'0')}:${String((index*7)%60).padStart(2,'0')}`,
    ...source,
    qty:1,
    amount:source.unitPrice
  }
})
const expenseTotal=expenseItems.reduce((sum,row)=>sum+Number(row.amount),0)

export const DEMO_SCENARIOS:DemoScenario[]=[
  {
    id:'A4',
    title:'A4 · 门诊费用明细',
    subtitle:'210 × 297mm · 固定纸张 · 多页分页',
    templateCode:'outpatient-expense-list',
    paperText:'A4 210×297mm',
    businessKeyPrefix:'DEMO-A4',
    inputData:{
      title:'费用明细清单',
      documentNo:'FYMX-20260922-000328',
      generatedAt:'2026-09-22 20:22',
      orgName:'东城人民医院',
      patientName:'张三',
      patientNo:'MZ202609220086',
      visitNo:'V202609220152',
      departmentName:'呼吸内科',
      doctorName:'李医生',
      dateFrom:'2026-09-22 09:02',
      dateTo:'2026-09-22 15:36',
      totalQty:expenseItems.length,
      totalAmount:expenseTotal,
      insuranceAmount:Math.round(expenseTotal*.62*100)/100,
      selfPayAmount:Math.round(expenseTotal*.38*100)/100,
      printedBy:'收费员 08',
      page:1,
      pages:1,
      items:expenseItems
    }
  },
  {
    id:'ROLL_80',
    title:'80mm · 门诊收费小票',
    subtitle:'80mm 卷纸 · 自动高度 · 内容决定纸长',
    templateCode:'demo-roll-receipt',
    paperText:'ROLL 80mm · AUTO',
    businessKeyPrefix:'DEMO-ROLL',
    inputData:{
      title:'门诊收费小票',
      receiptNo:'RC-20260922-0018',
      payTime:'2026-09-22 20:18:36',
      orgName:'东城人民医院',
      patientName:'张三',
      patientNo:'MZ202609220018',
      cashierName:'收费员 08',
      windowName:'门诊收费 03',
      paymentMethod:'医保 + 微信',
      totalAmount:346.5,
      insuranceAmount:220,
      selfPayAmount:126.5,
      verifyCode:'RC202609220018',
      items:[
        {name:'普通门诊诊察费',qty:1,amount:20},
        {name:'肺功能检查',qty:1,amount:100},
        {name:'布地奈德吸入剂',qty:1,amount:68.5},
        {name:'雾化吸入治疗',qty:2,amount:72},
        {name:'血氧饱和度测定',qty:1,amount:36},
        {name:'一次性雾化面罩',qty:1,amount:25},
        {name:'医用棉签',qty:2,amount:10},
        {name:'健康咨询',qty:1,amount:15}
      ]
    }
  },
  {
    id:'LABEL_70x40',
    title:'70×40mm · 药品标签',
    subtitle:'固定标签 · 203DPI · 二维码',
    templateCode:'demo-medicine-label',
    paperText:'LABEL 70×40mm',
    businessKeyPrefix:'DEMO-LABEL',
    inputData:{
      title:'药品标签',
      patientName:'张三',
      patientNo:'MZ202609220018',
      medicineName:'布地奈德吸入剂',
      spec:'200μg × 100吸',
      usage:'吸入，每次1吸，每日2次',
      frequency:'早 / 晚',
      departmentName:'呼吸内科',
      doctorName:'李医生',
      labelCode:'MED-20260922-018'
    }
  }
]

export function cloneScenarioData(scenario:DemoScenario):Record<string,unknown>{
  return structuredClone(scenario.inputData)
}

export function makeBusinessKey(prefix:string):string{
  const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14)
  return `${prefix}-${stamp}`
}
