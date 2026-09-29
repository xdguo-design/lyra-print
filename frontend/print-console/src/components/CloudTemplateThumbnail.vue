<script setup lang="ts">
import { computed } from 'vue'
import type { TemplateDesign,TemplateElement } from '../types'

const props=defineProps<{
  design?:TemplateDesign|null
  styleKey?:string
  title?:string
}>()

const palette:Record<string,{ink:string;muted:string;accent:string;paper:string}>={
  navy:{ink:'#17324d',muted:'#dce8f0',accent:'#2f6f9d',paper:'#fff'},
  sand:{ink:'#5f4638',muted:'#f1e5da',accent:'#a06c45',paper:'#fffdf9'},
  green:{ink:'#23483d',muted:'#dcebe5',accent:'#377862',paper:'#fff'},
  blue:{ink:'#274c72',muted:'#dbe8f4',accent:'#4d7eae',paper:'#fff'},
  slate:{ink:'#364c5e',muted:'#e1e8ed',accent:'#5e7c91',paper:'#fff'},
  charcoal:{ink:'#30383d',muted:'#e6eaec',accent:'#59656c',paper:'#fff'},
  steel:{ink:'#3e5360',muted:'#e3eaed',accent:'#657f8b',paper:'#fff'},
  mono:{ink:'#151515',muted:'#ececec',accent:'#444',paper:'#fff'},
  plum:{ink:'#5d3b59',muted:'#ecdfeb',accent:'#805d7c',paper:'#fff'},
  teal:{ink:'#245863',muted:'#d9eaed',accent:'#3f7983',paper:'#fff'},
  mint:{ink:'#244c45',muted:'#dfeeea',accent:'#4d806f',paper:'#fbfffd'},
  orange:{ink:'#5a3e22',muted:'#f2e3d1',accent:'#b87838',paper:'#fffdf9'}
}

const colors=computed(()=>palette[props.styleKey||'slate']||palette.slate)
const page=computed(()=>{
  const p=props.design?.paper
  if(!p)return {width:210,height:297}
  if(p.orientation==='LANDSCAPE'&&!p.autoHeight)return {width:p.height,height:p.width}
  return {width:p.width,height:p.autoHeight?Math.max(120,p.height||120):p.height}
})
const ratio=computed(()=>page.value.width/Math.max(1,page.value.height))
const elements=computed(()=>[...(props.design?.elements||[])]
  .filter(e=>e.visible)
  .sort((a,b)=>a.zIndex-b.zIndex)
  .slice(0,24)
)

function styleFor(el:TemplateElement){
  const width=page.value.width,height=page.value.height
  return {
    left:(el.x/width*100)+'%',
    top:(el.y/height*100)+'%',
    width:(el.w/width*100)+'%',
    height:(el.h/height*100)+'%'
  }
}
function textFor(el:TemplateElement){
  return (el.text||'')
    .replace(/{{s*([A-Za-z0-9_.-]+)s*}}/g,(_,key)=>String(key).split('.').pop()||'')
    .replace(/s+/g,' ')
    .trim()
    .slice(0,28)
}
</script>

<template>
  <div class="thumb-shell" :style="{'--ink':colors.ink,'--muted':colors.muted,'--accent':colors.accent,'--paper':colors.paper}">
    <div class="paper" :style="{aspectRatio:String(ratio)}">
      <template v-if="design">
        <div
          v-for="el in elements"
          :key="el.id"
          class="mini-el"
          :class="'kind-'+el.type.toLowerCase()"
          :style="styleFor(el)"
        >
          <template v-if="el.type==='TABLE'">
            <div class="table-head"></div>
            <i v-for="n in 4" :key="n"></i>
          </template>
          <template v-else-if="el.type==='QRCODE'">
            <span class="qr-grid"></span>
          </template>
          <template v-else-if="el.type==='BARCODE'">
            <span class="barcode"></span>
          </template>
          <template v-else-if="el.type==='LINE'"></template>
          <span v-else>{{textFor(el)}}</span>
        </div>
      </template>
      <template v-else>
        <div class="fallback-title">{{title}}</div>
        <div class="fallback-line w70"></div>
        <div class="fallback-line w45"></div>
        <div class="fallback-table">
          <i v-for="n in 6" :key="n"></i>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.thumb-shell{
  min-height:190px;display:grid;place-items:center;padding:14px;
  border-radius:14px;background:linear-gradient(150deg,var(--muted),#f4f7f9 58%,#e9eef2);
  overflow:hidden
}
.paper{
  position:relative;height:162px;max-width:92%;background:var(--paper);
  box-shadow:0 10px 28px rgba(24,45,62,.16),0 0 0 1px rgba(60,83,101,.12);
  overflow:hidden
}
.mini-el{position:absolute;overflow:hidden;color:var(--ink);font-size:3.3px;line-height:1.15}
.mini-el>span{display:block;overflow:hidden;white-space:nowrap;text-overflow:clip}
.kind-title,.mini-el[data-type="title"]{font-weight:800}
.kind-line{border-top:1px solid var(--accent)}
.kind-table{border:1px solid color-mix(in srgb,var(--ink) 45%,transparent);display:grid;grid-template-rows:14% repeat(4,1fr)}
.kind-table .table-head{background:var(--muted);border-bottom:1px solid color-mix(in srgb,var(--ink) 35%,transparent)}
.kind-table i{display:block;border-bottom:1px solid color-mix(in srgb,var(--ink) 18%,transparent)}
.kind-qrcode{display:grid;place-items:center}
.qr-grid{
  width:85%;height:85%;background:
    linear-gradient(90deg,var(--ink) 25%,transparent 25% 50%,var(--ink) 50% 75%,transparent 75%),
    linear-gradient(var(--ink) 25%,transparent 25% 50%,var(--ink) 50% 75%,transparent 75%);
  background-size:5px 5px
}
.kind-barcode{display:grid;place-items:center}
.barcode{width:90%;height:80%;background:repeating-linear-gradient(90deg,var(--ink) 0 1px,transparent 1px 2px,var(--ink) 2px 4px,transparent 4px 5px)}
.fallback-title{position:absolute;left:10%;top:10%;font-size:7px;font-weight:800;color:var(--ink)}
.fallback-line{position:absolute;left:10%;height:3px;background:var(--muted);border-radius:2px}.fallback-line.w70{top:24%;width:70%}.fallback-line.w45{top:31%;width:45%}
.fallback-table{position:absolute;left:10%;right:10%;top:42%;bottom:18%;border:1px solid var(--muted);display:grid}
.fallback-table i{border-bottom:1px solid var(--muted)}
</style>
