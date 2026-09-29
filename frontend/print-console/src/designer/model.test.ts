import { describe,expect,it } from 'vitest'
import {
  adaptiveReceiptLayout,aggregate,createElement,defaultTable,formatValue,normalizeDesign,paginateRows,
  renderText,resolvePath,tableRows
} from './model'
import type { TemplateDesign } from '../types'

describe('template designer model',()=>{
  it('resolves nested fields and keeps unknown variables visible',()=>{
    const data={patient:{name:'张三'},order:{code:'OP-001'}}
    expect(resolvePath(data,'patient.name')).toBe('张三')
    expect(renderText('患者：{{patient.name}} / {{missing}}',data))
      .toBe('患者：张三 / {{missing}}')
  })

  it('formats values and aggregates detail rows',()=>{
    const rows=[
      {name:'A',qty:1,amount:20},
      {name:'B',qty:2,amount:30},
      {name:'C',qty:3,amount:50}
    ]
    expect(aggregate(rows,'amount','SUM')).toBe(100)
    expect(aggregate(rows,'amount','AVG')).toBeCloseTo(100/3)
    expect(aggregate(rows,'amount','COUNT')).toBe(3)
    expect(formatValue(266,{key:'amount',label:'金额',width:40,align:'right',format:'CURRENCY'}))
      .toMatch(/266\.00/)
  })

  it('paginates detail rows deterministically',()=>{
    const rows=Array.from({length:43},(_,i)=>({name:'项目'+(i+1),amount:i+1}))
    const config={...defaultTable(),pageRows:18}
    const pages=paginateRows(rows,config)
    expect(pages).toHaveLength(3)
    expect(pages.map(p=>p.length)).toEqual([18,18,7])
    expect(pages[2][0].name).toBe('项目37')
  })


  it('expands receipt tables and shifts following elements',()=>{
    const table=createElement('TABLE',1,5,20)
    table.h=20
    table.table={...defaultTable(),rowHeight:6,showPageSubtotal:false,showGrandTotal:false}
    const footer=createElement('TEXT',2,5,45)
    footer.h=8
    const rows=Array.from({length:8},(_,i)=>({name:'项目'+i,qty:1,amount:10}))
    const layout=adaptiveReceiptLayout([table,footer],{items:rows},5,500)
    const laidTable=layout.elements.find(x=>x.id===table.id)!
    const laidFooter=layout.elements.find(x=>x.id===footer.id)!
    expect(laidTable.h).toBeGreaterThan(20)
    expect(laidFooter.y).toBeGreaterThan(footer.y)
    expect(layout.height).toBeGreaterThan(laidFooter.y+laidFooter.h)
    expect(layout.height).toBeLessThanOrEqual(500)
  })

  it('creates a fully configured table element',()=>{
    const el=createElement('TABLE',1,10,20)
    expect(el.binding).toBe('items')
    expect(el.table?.columns).toHaveLength(3)
    expect(el.table?.repeatHeader).toBe(true)
    expect(el.style.fontFamily).toContain('Arial')
  })

  it('normalizes older template designs without losing content',()=>{
    const design={
      paper:{size:'A4',width:210,height:297,orientation:'PORTRAIT',marginTop:10,marginRight:10,marginBottom:10,marginLeft:10},
      grid:true,
      snap:true,
      elements:[{
        id:'legacy-text',type:'TEXT',x:10,y:10,w:40,h:8,text:'{{patient.name}}',
        binding:'patient.name',visible:true,locked:false,fontSize:12,zIndex:1
      }]
    } as unknown as TemplateDesign
    const normalized=normalizeDesign(design)
    expect(normalized.paper.dpi).toBe(96)
    expect(normalized.elements[0].text).toBe('{{patient.name}}')
    expect(normalized.elements[0].style.textAlign).toBe('left')
  })

  it('reads table rows through nested binding path',()=>{
    const el=createElement('TABLE',1)
    el.binding='invoice.items'
    const data={invoice:{items:[{name:'检查费',amount:160}]}}
    expect(tableRows(el,data)).toEqual([{name:'检查费',amount:160}])
  })
})
