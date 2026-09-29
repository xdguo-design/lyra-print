import { Empty } from 'antd'
import { useMemo,type DragEvent,type PointerEvent as ReactPointerEvent } from 'react'
import { ElementBox } from './ElementBox'
import { MM_TO_PX } from './geometry'
import { paperSize,type TemplateElementType } from './model'
import { useDesignerStore } from './store'

export function DesignerCanvas({readOnly=false}:{readOnly?:boolean}){
  const design=useDesignerStore(state=>state.design)
  const selectedId=useDesignerStore(state=>state.selectedId)
  const zoom=useDesignerStore(state=>state.zoom)
  const select=useDesignerStore(state=>state.select)
  const addElement=useDesignerStore(state=>state.addElement)

  const sorted=useMemo(
    ()=>[...(design?.elements??[])].sort((a,b)=>a.zIndex-b.zIndex),
    [design?.elements],
  )

  if(!design)return <Empty description="模板设计尚未加载"/>

  const size=paperSize(design.paper)
  const scale=MM_TO_PX*zoom
  const width=size.width*scale
  const height=size.height*scale

  const clearSelection=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(event.target===event.currentTarget)select(null)
  }

  const drop=(event:DragEvent<HTMLDivElement>)=>{
    event.preventDefault()
    if(readOnly)return
    const type=event.dataTransfer.getData('application/x-print-element') as TemplateElementType
    if(!type)return
    const rect=event.currentTarget.getBoundingClientRect()
    const x=(event.clientX-rect.left)/scale
    const y=(event.clientY-rect.top)/scale
    addElement(type,x,y)
  }

  return (
    <div className="designer-canvas-scroll">
      <div className="designer-ruler-caption">{Math.round(zoom*100)}% · {size.width} × {size.height} mm</div>
      <div className="paper-stage">
        <div
          className={'paper-canvas'+(design.grid?' grid-enabled':'')}
          style={{
            width,
            height,
            backgroundSize:design.grid?(15*zoom)+'px '+(15*zoom)+'px':undefined,
          }}
          onPointerDown={clearSelection}
          onDragOver={event=>event.preventDefault()}
          onDrop={drop}
        >
          <div
            className="print-margin"
            style={{
              left:design.paper.marginLeft*scale,
              top:design.paper.marginTop*scale,
              right:design.paper.marginRight*scale,
              bottom:design.paper.marginBottom*scale,
            }}
          />
          {sorted.map(element=>(
            <ElementBox
              key={element.id}
              element={element}
              paper={design.paper}
              zoom={zoom}
              scale={scale}
              selected={element.id===selectedId}
              snap={design.snap}
              readOnly={readOnly}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
