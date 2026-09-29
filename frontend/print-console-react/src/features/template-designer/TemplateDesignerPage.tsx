import {
  ArrowLeftOutlined,
  DeleteOutlined,
  LockOutlined,
  SaveOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons'
import { App,Button,Card,InputNumber,Space,Tag,Tooltip } from 'antd'
import { useEffect,useMemo } from 'react'
import { useNavigate,useParams } from 'react-router-dom'
import { DesignerCanvas } from './DesignerCanvas'
import { elementTypeLabel,type ElementFrame,type TemplateElementType } from './model'
import { useDesignerStore } from './store'
import { useSaveTemplateDraft,useTemplate } from '@/features/templates/queries'
import { ErrorState,LoadingState } from '@/shared/components/StateViews'
import './designer.css'

const palette:TemplateElementType[]=[
  'TEXT','LONG_TEXT','TITLE','IMAGE','LINE','RECT','TABLE','BARCODE','QRCODE',
  'DATE','PAGE','AMOUNT','HEADER','FOOTER','WATERMARK',
]

function errorMessage(error:unknown,fallback:string){
  if(error&&typeof error==='object'&&'message' in error&&typeof error.message==='string')return error.message
  return fallback
}

export function TemplateDesignerPage(){
  const {message}=App.useApp()
  const navigate=useNavigate()
  const {templateId=''}=useParams()
  const templateQuery=useTemplate(templateId)
  const saveMutation=useSaveTemplateDraft()

  const storeTemplateId=useDesignerStore(state=>state.templateId)
  const design=useDesignerStore(state=>state.design)
  const selectedId=useDesignerStore(state=>state.selectedId)
  const zoom=useDesignerStore(state=>state.zoom)
  const dirty=useDesignerStore(state=>state.dirty)
  const hydrate=useDesignerStore(state=>state.hydrate)
  const select=useDesignerStore(state=>state.select)
  const setZoom=useDesignerStore(state=>state.setZoom)
  const updateFrame=useDesignerStore(state=>state.updateFrame)
  const addElement=useDesignerStore(state=>state.addElement)
  const removeSelected=useDesignerStore(state=>state.removeSelected)
  const markSaved=useDesignerStore(state=>state.markSaved)

  const template=templateQuery.data
  const readOnly=template?.status==='DISABLED'

  useEffect(()=>{
    if(template&&storeTemplateId!==template.id)hydrate(template.id,template.design)
  },[hydrate,storeTemplateId,template])

  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement|null
      if(target&&(['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable))return
      if((event.key==='Delete'||event.key==='Backspace')&&!readOnly){
        event.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[readOnly,removeSelected])

  const selected=useMemo(
    ()=>design?.elements.find(element=>element.id===selectedId)??null,
    [design?.elements,selectedId],
  )
  const layers=useMemo(
    ()=>[...(design?.elements??[])].sort((a,b)=>b.zIndex-a.zIndex),
    [design?.elements],
  )

  async function save(){
    if(!template||!design||readOnly||!dirty)return
    try{
      await saveMutation.mutateAsync({
        id:template.id,
        input:{
          name:template.name,
          design,
          sampleData:template.sampleData,
          dataConfig:template.dataConfig,
        },
      })
      markSaved()
      message.success('草稿已保存')
    }catch(error){
      message.error(errorMessage(error,'草稿保存失败'))
    }
  }

  function patchFrame(patch:Partial<ElementFrame>){
    if(!selected||readOnly||selected.locked)return
    updateFrame(selected.id,{
      x:patch.x??selected.x,
      y:patch.y??selected.y,
      w:patch.w??selected.w,
      h:patch.h??selected.h,
    })
  }

  if(templateQuery.isPending)return <LoadingState label="正在加载模板设计器…"/>
  if(templateQuery.isError)return <ErrorState title="模板加载失败" message={templateQuery.error.message} onRetry={()=>void templateQuery.refetch()}/>
  if(!template)return <ErrorState title="模板不存在" message="没有找到要编辑的模板。"/>
  if(!design)return <LoadingState label="正在初始化 Canvas…"/>

  return (
    <div className="template-designer-page">
      <header className="designer-topbar">
        <div className="designer-title">
          <Button type="text" icon={<ArrowLeftOutlined/>} onClick={()=>navigate('/templates')}/>
          <div>
            <div className="designer-title-line">
              <strong>{template.name}</strong>
              <Tag color={readOnly?'default':'blue'}>{template.status}</Tag>
              {dirty&&<Tag color="orange">未保存</Tag>}
              {readOnly&&<Tag icon={<LockOutlined/>}>只读</Tag>}
            </div>
            <small>{template.code} · 草稿修订 {template.draftRevision}{template.publishedVersion?' · 已发布 v'+template.publishedVersion:''}</small>
          </div>
        </div>
        <Space>
          <Button icon={<ZoomOutOutlined/>} onClick={()=>setZoom(zoom-.1)} disabled={zoom<=.5}/>
          <span className="zoom-value">{Math.round(zoom*100)}%</span>
          <Button icon={<ZoomInOutlined/>} onClick={()=>setZoom(zoom+.1)} disabled={zoom>=2}/>
          <Button
            type="primary"
            icon={<SaveOutlined/>}
            disabled={!dirty||readOnly}
            loading={saveMutation.isPending}
            onClick={()=>void save()}
          >
            保存草稿
          </Button>
        </Space>
      </header>

      <div className="designer-workspace">
        <aside className="designer-panel palette-panel">
          <div className="panel-heading">
            <div><strong>元素</strong><small>点击或拖入画布</small></div>
          </div>
          <div className="palette-grid">
            {palette.map(type=>(
              <button
                key={type}
                type="button"
                draggable={!readOnly}
                disabled={readOnly}
                onDragStart={event=>event.dataTransfer.setData('application/x-print-element',type)}
                onClick={()=>addElement(type,20+(design.elements.length%5)*5,20+(design.elements.length%6)*5)}
              >
                <b>{elementTypeLabel[type].slice(0,1)}</b>
                <span>{elementTypeLabel[type]}</span>
              </button>
            ))}
          </div>

          <div className="panel-heading layer-heading">
            <div><strong>图层</strong><small>{layers.length} 个元素</small></div>
          </div>
          <div className="layer-list">
            {layers.map(element=>(
              <button
                type="button"
                key={element.id}
                className={'layer-item'+(element.id===selectedId?' active':'')}
                onClick={()=>select(element.id)}
              >
                <span>{elementTypeLabel[element.type]} · {element.text||element.id}</span>
                <small>{element.locked?'锁定':'z'+element.zIndex}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="designer-canvas-panel">
          <div className="canvas-toolbar">
            <Space size={8}>
              <Tag color={design.grid?'blue':'default'}>网格 {design.grid?'开':'关'}</Tag>
              <Tag color={design.snap?'cyan':'default'}>5mm 吸附 {design.snap?'开':'关'}</Tag>
              <span className="canvas-tip">拖拽移动 · 选中后使用八个控制点缩放</span>
            </Space>
          </div>
          <DesignerCanvas readOnly={readOnly}/>
        </section>

        <aside className="designer-panel inspector-panel">
          <div className="panel-heading">
            <div><strong>属性</strong><small>基础几何属性</small></div>
            {selected&&!readOnly&&!selected.locked&&(
              <Tooltip title="删除元素">
                <Button danger type="text" icon={<DeleteOutlined/>} onClick={removeSelected}/>
              </Tooltip>
            )}
          </div>

          {!selected?(
            <div className="inspector-empty">选择画布中的元素后查看位置和尺寸。</div>
          ):(
            <>
              <Card size="small" className="selected-summary">
                <strong>{elementTypeLabel[selected.type]}</strong>
                <span className="mono">{selected.id}</span>
                <div>
                  {selected.locked&&<Tag>已锁定</Tag>}
                  {!selected.visible&&<Tag>已隐藏</Tag>}
                </div>
              </Card>

              <div className="frame-fields">
                <label>X / mm<InputNumber value={selected.x} min={0} step={1} disabled={readOnly||selected.locked} onChange={value=>typeof value==='number'&&patchFrame({x:value})}/></label>
                <label>Y / mm<InputNumber value={selected.y} min={0} step={1} disabled={readOnly||selected.locked} onChange={value=>typeof value==='number'&&patchFrame({y:value})}/></label>
                <label>宽 / mm<InputNumber value={selected.w} min={2} step={1} disabled={readOnly||selected.locked} onChange={value=>typeof value==='number'&&patchFrame({w:value})}/></label>
                <label>高 / mm<InputNumber value={selected.h} min={2} step={1} disabled={readOnly||selected.locked} onChange={value=>typeof value==='number'&&patchFrame({h:value})}/></label>
              </div>

              <div className="inspector-section">
                <span>内容</span>
                <strong>{selected.text||'—'}</strong>
              </div>
              <div className="inspector-section">
                <span>绑定</span>
                <strong className="mono">{selected.binding||'未绑定'}</strong>
              </div>
              <div className="inspector-section">
                <span>层级</span>
                <strong>{selected.zIndex}</strong>
              </div>
              <div className="inspector-note">
                本阶段只迁移 Canvas、元素模型、选中、拖拽和缩放。文本样式、表格配置、数据绑定、Undo/Redo 和参考图会在后续设计器阶段继续接入。
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
