import { describe,expect,it } from 'vitest'
import { moveFrame,resizeFrame,snapMm } from './geometry'
import type { TemplatePaper } from './model'

const paper:TemplatePaper={
  size:'A4',
  width:210,
  height:297,
  orientation:'PORTRAIT',
  marginTop:10,
  marginRight:10,
  marginBottom:10,
  marginLeft:10,
}

describe('designer geometry',()=>{
  it('snaps movement to 5mm and keeps the element inside paper',()=>{
    expect(moveFrame({x:12,y:17,w:40,h:20},4,4,paper,true)).toEqual({x:15,y:20,w:40,h:20})
    expect(moveFrame({x:190,y:290,w:30,h:20},20,20,paper,false)).toEqual({x:180,y:277,w:30,h:20})
  })

  it('resizes from south-east and clamps to paper bounds',()=>{
    expect(resizeFrame({x:10,y:10,w:40,h:20},'se',13,17,paper,true)).toEqual({x:10,y:10,w:55,h:35})
    expect(resizeFrame({x:190,y:280,w:20,h:17},'se',50,50,paper,false)).toEqual({x:190,y:280,w:20,h:17})
  })

  it('resizes from north-west without crossing the minimum size',()=>{
    expect(resizeFrame({x:20,y:20,w:30,h:20},'nw',5,5,paper,false)).toEqual({x:25,y:25,w:25,h:15})
    const tiny=resizeFrame({x:20,y:20,w:10,h:10},'nw',50,50,paper,false)
    expect(tiny.w).toBeGreaterThanOrEqual(2)
    expect(tiny.h).toBeGreaterThanOrEqual(2)
  })

  it('can disable grid snapping',()=>{
    expect(snapMm(12.34,false)).toBe(12.3)
    expect(snapMm(12.34,true)).toBe(10)
  })
})
