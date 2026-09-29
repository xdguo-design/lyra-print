import { useRef,type CSSProperties,type PointerEvent as ReactPointerEvent } from 'react'
import { mmDelta,moveFrame,resizeFrame,type ResizeHandle } from './geometry'
import { elementTypeLabel,type ElementFrame,type TemplateElement,type TemplatePaper } from './model'
import { useDesignerStore } from './store'

const handles:ResizeHandle[]=['nw','n','ne','e','se','s','sw','w']

interface Interaction{
  pointerId:number
  mode:'move'|'resize'
  handle?:ResizeHandle
  clientX:number
  clientY:number
  frame:ElementFrame
}

interface ElementBoxProps{
  element:TemplateElement
  paper:TemplatePaper
  zoom:number
  scale:number
  selected:boolean
  snap:boolean
  readOnly:boolean
}

export function ElementBox({element,paper,zoom,scale,selected,snap,readOnly}:ElementBoxProps){
  const select=useDesignerStore(state=>state.select)
  const updateFrame=useDesignerStore(state=>state.updateFrame)
  const interaction=useRef<Interaction|null>(null)
  const locked=readOnly||element.locked

  const beginMove=(event:ReactPointerEvent<HTMLDivElement>)=>{
    event.stopPropagation()
    select(element.id)
    if(locked||event.button!==0)return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    interaction.current={
      pointerId:event.pointerId,
      mode:'move',
      clientX:event.clientX,
      clientY:event.clientY,
      frame:{x:element.x,y:element.y,w:element.w,h:element.h},
    }
  }

  const beginResize=(handle:ResizeHandle,event:ReactPointerEvent<HTMLButtonElement>)=>{
    event.stopPropagation()
    select(element.id)
    if(locked||event.button!==0)return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    interaction.current={
      pointerId:event.pointerId,
      mode:'resize',
      handle,
      clientX:event.clientX,
      clientY:event.clientY,
      frame:{x:element.x,y:element.y,w:element.w,h:element.h},
    }
  }

  const move=(event:ReactPointerEvent<HTMLElement>)=>{
    const current=interaction.current
    if(!current||current.pointerId!==event.pointerId)return
    const dx=mmDelta(event.clientX-current.clientX,zoom)
    const dy=mmDelta(event.clientY-current.clientY,zoom)
    const next=current.mode==='move'
      ? moveFrame(current.frame,dx,dy,paper,snap)
      : resizeFrame(current.frame,current.handle??'se',dx,dy,paper,snap)
    updateFrame(element.id,next)
  }

  const end=(event:ReactPointerEvent<HTMLElement>)=>{
    if(interaction.current?.pointerId!==event.pointerId)return
    interaction.current=null
    try{event.currentTarget.releasePointerCapture(event.pointerId)}catch{/* pointer capture may already be released */}
  }

  const frameStyle:CSSProperties={
    left:element.x*scale,
    top:element.y*scale,
    width:Math.max(1,element.w*scale),
    height:Math.max(1,element.h*scale),
    zIndex:element.zIndex,
    display:element.visible?'block':'none',
  }
  const contentStyle:CSSProperties={
    fontFamily:element.style.fontFamily,
    fontWeight:element.style.fontWeight,
    fontStyle:element.style.fontStyle,
    textDecoration:element.style.textDecoration,
    color:element.style.color,
    background:element.style.background,
    borderColor:element.style.borderColor,
    borderWidth:element.type==='LINE'?0:element.style.borderWidth,
    borderStyle:'solid',
    opacity:element.style.opacity,
    transform:'rotate('+element.style.rotation+'deg)',
    transformOrigin:'center',
    fontSize:Math.max(7,element.fontSize*zoom),
    textAlign:element.style.textAlign,
    justifyContent:element.style.textAlign==='center'?'center':element.style.textAlign==='right'?'flex-end':'flex-start',
    alignItems:element.style.verticalAlign==='top'?'flex-start':element.style.verticalAlign==='bottom'?'flex-end':'center',
  }

  return (
    <div
      className={'designer-element'+(selected?' selected':'')+(locked?' locked':'')}
      style={frameStyle}
      data-element-id={element.id}
      onPointerDown={beginMove}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      title={elementTypeLabel[element.type]+(element.locked?' · 已锁定':'')}
    >
      <div className={'designer-element-content type-'+element.type.toLowerCase()} style={contentStyle}>
        <ElementContent element={element}/>
      </div>
      {selected&&!locked&&handles.map(handle=>(
        <button
          key={handle}
          type="button"
          aria-label={'缩放 '+handle}
          className={'resize-handle handle-'+handle}
          onPointerDown={event=>beginResize(handle,event)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
      {selected&&element.locked&&<span className="element-lock-badge">锁定</span>}
    </div>
  )
}

function ElementContent({element}:{element:TemplateElement}){
  if(element.type==='LINE')return <span className="line-preview" style={{borderColor:element.style.borderColor}}/>
  if(element.type==='RECT')return <span className="rect-preview"/>
  if(element.type==='IMAGE'){
    return element.src
      ? <img className="image-preview" src={element.src} alt={element.text||'图片'}/>
      : <span className="element-placeholder">图片</span>
  }
  if(element.type==='QRCODE'){
    return <span className="qr-preview" aria-label="二维码占位"><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>
  }
  if(element.type==='BARCODE'){
    return <span className="barcode-preview" aria-label="条码占位"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>
  }
  if(element.type==='TABLE'){
    const columns=element.table?.columns??[]
    return (
      <div className="table-preview">
        <div className="table-preview-row header">
          {columns.map(column=><span key={column.key} style={{flex:Math.max(1,column.width)}}>{column.label}</span>)}
        </div>
        <div className="table-preview-row"><span>数据区域 · {element.binding||'items'}</span></div>
        <div className="table-preview-row faint"><span>…</span></div>
      </div>
    )
  }
  return <span className="text-preview">{element.text||elementTypeLabel[element.type]}</span>
}
