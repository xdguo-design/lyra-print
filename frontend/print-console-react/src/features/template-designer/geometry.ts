import type { ElementFrame,TemplatePaper } from './model'
import { paperSize } from './model'

export type ResizeHandle='n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw'

export const MM_TO_PX=3
export const MIN_ELEMENT_MM=2

export function snapMm(value:number,enabled:boolean,step=5){
  if(!enabled)return Math.round(value*10)/10
  return Math.round(value/step)*step
}

export function moveFrame(
  frame:ElementFrame,
  dx:number,
  dy:number,
  paper:TemplatePaper,
  snap:boolean,
):ElementFrame{
  const bounds=paperSize(paper)
  const x=Math.max(0,Math.min(bounds.width-frame.w,snapMm(frame.x+dx,snap)))
  const y=Math.max(0,Math.min(bounds.height-frame.h,snapMm(frame.y+dy,snap)))
  return {...frame,x,y}
}

export function resizeFrame(
  frame:ElementFrame,
  handle:ResizeHandle,
  dx:number,
  dy:number,
  paper:TemplatePaper,
  snap:boolean,
):ElementFrame{
  const bounds=paperSize(paper)
  let left=frame.x
  let top=frame.y
  let right=frame.x+frame.w
  let bottom=frame.y+frame.h

  if(handle.includes('e'))right=snapMm(right+dx,snap)
  if(handle.includes('s'))bottom=snapMm(bottom+dy,snap)
  if(handle.includes('w'))left=snapMm(left+dx,snap)
  if(handle.includes('n'))top=snapMm(top+dy,snap)

  left=Math.max(0,Math.min(left,bounds.width-MIN_ELEMENT_MM))
  top=Math.max(0,Math.min(top,bounds.height-MIN_ELEMENT_MM))
  right=Math.min(bounds.width,Math.max(right,MIN_ELEMENT_MM))
  bottom=Math.min(bounds.height,Math.max(bottom,MIN_ELEMENT_MM))

  if(right-left<MIN_ELEMENT_MM){
    if(handle.includes('w'))left=right-MIN_ELEMENT_MM
    else right=left+MIN_ELEMENT_MM
  }
  if(bottom-top<MIN_ELEMENT_MM){
    if(handle.includes('n'))top=bottom-MIN_ELEMENT_MM
    else bottom=top+MIN_ELEMENT_MM
  }

  left=Math.max(0,left)
  top=Math.max(0,top)
  right=Math.min(bounds.width,right)
  bottom=Math.min(bounds.height,bottom)

  return {
    x:Math.round(left*10)/10,
    y:Math.round(top*10)/10,
    w:Math.round((right-left)*10)/10,
    h:Math.round((bottom-top)*10)/10,
  }
}

export function mmDelta(clientDelta:number,zoom:number){
  return clientDelta/(MM_TO_PX*zoom)
}
