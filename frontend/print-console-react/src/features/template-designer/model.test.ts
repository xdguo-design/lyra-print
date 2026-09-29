import { describe,expect,it } from 'vitest'
import { createElement,normalizeDesign,paperSize } from './model'

describe('designer element model',()=>{
  it('normalizes legacy design fields without changing mm geometry',()=>{
    const referenceImage={fileName:'reference.png'}
    const design=normalizeDesign({
      paper:{size:'A4',width:210,height:297,orientation:'PORTRAIT',marginTop:10,marginRight:10,marginBottom:10,marginLeft:10},
      grid:true,
      snap:true,
      referenceImage,
      elements:[{
        id:'title',
        type:'TITLE',
        x:20,
        y:15,
        w:100,
        h:16,
        text:'测试标题',
        visible:true,
        locked:false,
        fontSize:18,
        zIndex:2,
        style:{fontWeight:'700'},
      }],
    })
    expect(design.elements[0]?.x).toBe(20)
    expect(design.elements[0]?.style.fontWeight).toBe('700')
    expect(design.elements[0]?.style.color).toBe('#17365f')
    expect(design.referenceImage).toEqual(referenceImage)
  })

  it('creates elements compatible with the existing template design contract',()=>{
    const table=createElement('TABLE',3,25,30)
    expect(table.binding).toBe('items')
    expect(table.table?.columns).toHaveLength(3)
    expect(table.w).toBe(170)
    expect(table.zIndex).toBe(3)
  })

  it('swaps physical paper dimensions in landscape mode',()=>{
    expect(paperSize({
      size:'A4',width:210,height:297,orientation:'LANDSCAPE',
      marginTop:10,marginRight:10,marginBottom:10,marginLeft:10,
    })).toEqual({width:297,height:210})
  })
})
