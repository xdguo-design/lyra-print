import { create } from 'zustand'
import {
  createElement,
  normalizeDesign,
  paperSize,
  type ElementFrame,
  type TemplateDesign,
  type TemplateElement,
  type TemplateElementType,
} from './model'

interface DesignerState{
  templateId:string|null
  design:TemplateDesign|null
  selectedId:string|null
  zoom:number
  dirty:boolean
  hydrate:(templateId:string,design:unknown)=>void
  select:(id:string|null)=>void
  setZoom:(zoom:number)=>void
  updateFrame:(id:string,frame:ElementFrame)=>void
  updateElement:(id:string,patch:Partial<TemplateElement>)=>void
  addElement:(type:TemplateElementType,x?:number,y?:number)=>void
  removeSelected:()=>void
  markSaved:()=>void
}

export const useDesignerStore=create<DesignerState>((set,get)=>({
  templateId:null,
  design:null,
  selectedId:null,
  zoom:1,
  dirty:false,

  hydrate:(templateId,design)=>{
    const normalized=normalizeDesign(design)
    set({
      templateId,
      design:normalized,
      selectedId:normalized.elements[0]?.id??null,
      dirty:false,
    })
  },

  select:selectedId=>set({selectedId}),
  setZoom:zoom=>set({zoom:Math.max(.5,Math.min(2,zoom))}),

  updateFrame:(id,frame)=>set(state=>{
    if(!state.design)return state
    return {
      design:{
        ...state.design,
        elements:state.design.elements.map(element=>element.id===id?{...element,...frame}:element),
      },
      dirty:true,
    }
  }),

  updateElement:(id,patch)=>set(state=>{
    if(!state.design)return state
    return {
      design:{
        ...state.design,
        elements:state.design.elements.map(element=>element.id===id?{...element,...patch}:element),
      },
      dirty:true,
    }
  }),

  addElement:(type,x=20,y=20)=>{
    const state=get()
    if(!state.design)return
    const bounds=paperSize(state.design.paper)
    const element=createElement(type,state.design.elements.length+1,x,y)
    element.x=Math.max(0,Math.min(bounds.width-element.w,element.x))
    element.y=Math.max(0,Math.min(bounds.height-element.h,element.y))
    set({
      design:{...state.design,elements:[...state.design.elements,element]},
      selectedId:element.id,
      dirty:true,
    })
  },

  removeSelected:()=>set(state=>{
    if(!state.design||!state.selectedId)return state
    const current=state.design.elements.find(element=>element.id===state.selectedId)
    if(current?.locked)return state
    return {
      design:{...state.design,elements:state.design.elements.filter(element=>element.id!==state.selectedId)},
      selectedId:null,
      dirty:true,
    }
  }),

  markSaved:()=>set({dirty:false}),
}))
