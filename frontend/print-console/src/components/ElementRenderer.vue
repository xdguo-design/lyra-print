<script setup lang="ts">
import { computed } from 'vue'
import type { TemplateElement } from '../types'
import { renderText,resolvePath,tableRows } from '../designer/model'
import CodeImage from './CodeImage.vue'
import DynamicTable from './DynamicTable.vue'

const props=withDefaults(defineProps<{element:TemplateElement;data:Record<string,unknown>;rowsOverride?:Record<string,unknown>[];page?:number;pages?:number;showTableTotal?:boolean;showTableHeader?:boolean}>(),{page:1,pages:1,showTableTotal:true,showTableHeader:true})
const mergedData=computed(()=>({...props.data,page:props.page,pages:props.pages}))
const textValue=computed(()=>{const bound=props.element.binding?resolvePath(mergedData.value,props.element.binding):undefined;if(bound!=null&&props.element.type!=='TABLE')return String(bound);return renderText(props.element.text||'',mergedData.value)})
const rows=computed(()=>props.rowsOverride||tableRows(props.element,props.data))
</script>
<template>
<DynamicTable v-if="element.type==='TABLE'&&element.table" :config="element.table" :rows="rows" :show-grand-total="showTableTotal" :show-header="showTableHeader"/>
<CodeImage v-else-if="element.type==='QRCODE'" kind="QR" :value="textValue"/>
<CodeImage v-else-if="element.type==='BARCODE'" kind="BARCODE" :value="textValue" :format="element.barcodeFormat||'CODE128'"/>
<img v-else-if="element.type==='IMAGE'&&element.src" :src="element.src" class="element-image"/>
<div v-else-if="element.type==='IMAGE'" class="image-empty">右侧上传图片</div>
<span v-else>{{textValue}}</span>
</template>
<style scoped>.element-image{width:100%;height:100%;display:block;object-fit:contain}.image-empty{width:100%;height:100%;display:grid;place-items:center;background:#edf3f7;color:#8ca0b0;font-size:10px}</style>