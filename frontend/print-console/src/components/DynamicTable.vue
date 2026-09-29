<script setup lang="ts">
import { computed } from 'vue'
import type { TableConfig } from '../types'
import { aggregate,formatValue,resolvePath } from '../designer/model'

const props=withDefaults(defineProps<{config:TableConfig;rows:Record<string,unknown>[];showGrandTotal?:boolean;showHeader?:boolean}>(),{showGrandTotal:true,showHeader:true})
type DisplayItem={kind:'data'|'group'|'subtotal';row?:Record<string,unknown>;group?:string;rows?:Record<string,unknown>[];dataIndex?:number}
const visibleColumns=computed(()=>props.config.columns.filter(c=>!c.hidden))
const displayRows=computed<DisplayItem[]>(()=>{
  const groupBy=props.config.groupBy?.trim()
  if(!groupBy)return props.rows.map((row,index)=>({kind:'data',row,dataIndex:index}))
  const result:DisplayItem[]=[];let current='',bucket:Record<string,unknown>[]=[]
  const flush=()=>{if(!bucket.length)return;result.push({kind:'group',group:current,rows:[...bucket]});bucket.forEach((row,index)=>result.push({kind:'data',row,dataIndex:index}));result.push({kind:'subtotal',group:current,rows:[...bucket]});bucket=[]}
  for(const row of props.rows){const key=String(resolvePath(row,groupBy)??'未分组');if(bucket.length&&key!==current)flush();current=key;bucket.push(row)}flush();return result
})
function mergeAt(row:number,column:number){return props.config.merges?.find(m=>m.row===row&&m.column===column)}
function coveredByMerge(row:number,column:number){return props.config.merges?.some(m=>row>=m.row&&row<m.row+m.rowSpan&&column>=m.column&&column<m.column+m.colSpan&&!(row===m.row&&column===m.column))}
function aggregateText(rows:Record<string,unknown>[],key:string,kind?:string){if(!kind||kind==='NONE')return '';return formatValue(aggregate(rows,key,kind),{key,label:key,width:10,align:'right',format:kind==='COUNT'?'NUMBER':'CURRENCY'})}
</script>
<template>
<div v-if="rows.length||!config.hideWhenEmpty" class="table-shell">
  <table class="dynamic-table" :class="{'has-fixed-total':config.fixedTotal&&config.showGrandTotal&&showGrandTotal&&rows.length}">
    <colgroup><col v-for="col in visibleColumns" :key="col.key" :style="{width:col.width+'mm'}"/></colgroup>
    <thead v-if="showHeader">
      <tr v-for="(header,ri) in config.headerRows||[]" :key="'h'+ri"><th v-for="(cell,ci) in header.cells" :key="ci" :colspan="cell.colSpan" :rowspan="cell.rowSpan">{{cell.text}}</th></tr>
      <tr><th v-for="col in visibleColumns" :key="col.key" :style="{textAlign:col.align}">{{col.label}}</th></tr>
    </thead>
    <tbody>
      <template v-for="(item,displayIndex) in displayRows" :key="displayIndex">
        <tr v-if="item.kind==='group'" class="group-row"><td :colspan="visibleColumns.length">分组：{{item.group}}</td></tr>
        <tr v-else-if="item.kind==='subtotal'" class="subtotal-row"><td v-for="(col,ci) in visibleColumns" :key="col.key" :style="{textAlign:col.align}"><template v-if="ci===0">小计</template><template v-else>{{aggregateText(item.rows||[],col.key,col.aggregate)}}</template></td></tr>
        <tr v-else class="data-row"><template v-for="(col,ci) in visibleColumns" :key="col.key"><td v-if="!coveredByMerge(item.dataIndex||0,ci)" :rowspan="mergeAt(item.dataIndex||0,ci)?.rowSpan||1" :colspan="mergeAt(item.dataIndex||0,ci)?.colSpan||1" :style="{textAlign:col.align,height:config.rowHeight+'mm'}">{{formatValue(resolvePath(item.row,col.key),col)}}</td></template></tr>
      </template>
    </tbody>
    <tfoot v-if="rows.length&&(config.showPageSubtotal||(config.showGrandTotal&&showGrandTotal&&!config.fixedTotal))">
      <tr v-if="config.showPageSubtotal" class="page-subtotal-row"><td v-for="(col,ci) in visibleColumns" :key="'p'+col.key" :style="{textAlign:col.align}"><template v-if="ci===0">本页小计</template><template v-else>{{aggregateText(rows,col.key,col.aggregate)}}</template></td></tr>
      <tr v-if="config.showGrandTotal&&showGrandTotal&&!config.fixedTotal"><td v-for="(col,ci) in visibleColumns" :key="'g'+col.key" :style="{textAlign:col.align}"><template v-if="ci===0">总计</template><template v-else>{{aggregateText(rows,col.key,col.aggregate)}}</template></td></tr>
    </tfoot>
  </table>
  <table v-if="config.fixedTotal&&config.showGrandTotal&&showGrandTotal&&rows.length" class="dynamic-table fixed-total-table"><colgroup><col v-for="col in visibleColumns" :key="col.key" :style="{width:col.width+'mm'}"/></colgroup><tbody><tr><td v-for="(col,ci) in visibleColumns" :key="col.key" :style="{textAlign:col.align}"><template v-if="ci===0">总计</template><template v-else>{{aggregateText(rows,col.key,col.aggregate)}}</template></td></tr></tbody></table>
</div>
<div v-else class="empty-table">空数据隐藏</div>
</template>
<style scoped>
.table-shell{position:relative;width:100%;height:100%;overflow:hidden}.dynamic-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:inherit;color:inherit;background:inherit}.dynamic-table th,.dynamic-table td{border:1px solid currentColor;padding:1mm;overflow:hidden;word-break:break-all}.dynamic-table thead th{font-weight:600;background:rgba(230,240,248,.65)}.group-row td{font-weight:600;background:rgba(220,236,248,.65)}.subtotal-row td,.dynamic-table tfoot td,.fixed-total-table td{font-weight:600;background:rgba(242,247,250,.95)}.page-subtotal-row td{background:rgba(232,242,250,.95)}.has-fixed-total{padding-bottom:8mm}.fixed-total-table{position:absolute;left:0;right:0;bottom:0;background:#fff}.empty-table{width:100%;height:100%;display:grid;place-items:center;border:1px dashed #bac8d2;color:#9aa9b5}
</style>