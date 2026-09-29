<script setup lang="ts">
import { computed,reactive,toRaw } from 'vue'
import type { TableColumn,TableConfig } from '../types'
import { defaultTable } from '../designer/model'

const props=defineProps<{modelValue:TableConfig}>()
const emit=defineEmits<{(e:'update:modelValue',value:TableConfig):void}>()
const mergeForm=reactive({row:0,column:0,rowSpan:1,colSpan:2})
const model=computed({get:()=>props.modelValue||defaultTable(),set:value=>emit('update:modelValue',value)})

function mutate(fn:(draft:TableConfig)=>void){const next=structuredClone(toRaw(model.value) as TableConfig);fn(next);model.value=next}
function addColumn(){mutate(t=>t.columns.push({key:'field'+(t.columns.length+1),label:'新列',width:40,align:'left',aggregate:'NONE',format:'TEXT'}))}
function removeColumn(index:number){mutate(t=>{if(t.columns.length>1)t.columns.splice(index,1)})}
function moveColumn(index:number,delta:number){mutate(t=>{const to=index+delta;if(to<0||to>=t.columns.length)return;const [item]=t.columns.splice(index,1);t.columns.splice(to,0,item)})}
function updateColumn(index:number,key:keyof TableColumn,value:unknown){mutate(t=>(t.columns[index] as any)[key]=value)}
function addHeaderRow(){mutate(t=>{t.headerRows=t.headerRows||[];t.headerRows.push({cells:[{text:'分组表头',startColumn:0,colSpan:Math.max(1,t.columns.length),rowSpan:1}]})})}
function addHeaderCell(rowIndex:number){mutate(t=>t.headerRows?.[rowIndex]?.cells.push({text:'表头',startColumn:0,colSpan:1,rowSpan:1}))}
function removeHeaderRow(index:number){mutate(t=>t.headerRows?.splice(index,1))}
function updateHeaderCell(rowIndex:number,cellIndex:number,key:string,value:unknown){mutate(t=>{const cell=t.headerRows?.[rowIndex]?.cells[cellIndex] as any;if(cell)cell[key]=value})}
function removeHeaderCell(rowIndex:number,cellIndex:number){mutate(t=>t.headerRows?.[rowIndex]?.cells.splice(cellIndex,1))}
function addMerge(){mutate(t=>{t.merges=t.merges||[];t.merges.push({...mergeForm})})}
function removeMerge(index:number){mutate(t=>t.merges?.splice(index,1))}
</script>

<template>
<div class="table-designer">
  <div class="section-head"><strong>列设置</strong><a-button size="small" @click="addColumn">＋ 列</a-button></div>
  <div class="column-card" v-for="(col,index) in model.columns" :key="index">
    <div class="column-toolbar"><b>#{{index+1}}</b><span><button @click="moveColumn(index,-1)">←</button><button @click="moveColumn(index,1)">→</button><button @click="removeColumn(index)">×</button></span></div>
    <div class="two"><a-input size="small" :value="col.label" @update:value="updateColumn(index,'label',$event)" placeholder="列名"/><a-input size="small" :value="col.key" @update:value="updateColumn(index,'key',$event)" placeholder="字段"/></div>
    <div class="three">
      <a-input-number size="small" :value="col.width" @update:value="updateColumn(index,'width',Number($event)||20)" :min="10"/>
      <a-select size="small" :value="col.align" @update:value="updateColumn(index,'align',$event)"><a-select-option value="left">左</a-select-option><a-select-option value="center">中</a-select-option><a-select-option value="right">右</a-select-option></a-select>
      <a-select size="small" :value="col.format||'TEXT'" @update:value="updateColumn(index,'format',$event)"><a-select-option value="TEXT">文本</a-select-option><a-select-option value="NUMBER">数字</a-select-option><a-select-option value="CURRENCY">金额</a-select-option><a-select-option value="DATE">日期</a-select-option></a-select>
    </div>
    <a-select size="small" style="width:100%;margin-top:5px" :value="col.aggregate||'NONE'" @update:value="updateColumn(index,'aggregate',$event)"><a-select-option value="NONE">不汇总</a-select-option><a-select-option value="SUM">求和</a-select-option><a-select-option value="COUNT">计数</a-select-option><a-select-option value="AVG">平均</a-select-option></a-select>
  </div>

  <a-divider/>
  <div class="section-head"><strong>多行表头</strong><a-button size="small" @click="addHeaderRow">＋ 表头行</a-button></div>
  <div class="header-row" v-for="(row,ri) in model.headerRows||[]" :key="ri">
    <div class="section-head"><span>表头行 {{ri+1}}</span><a-space><a-button size="small" @click="addHeaderCell(ri)">＋ 单元格</a-button><a-button size="small" danger @click="removeHeaderRow(ri)">删行</a-button></a-space></div>
    <div class="header-cell" v-for="(cell,ci) in row.cells" :key="ci">
      <a-input size="small" :value="cell.text" @update:value="updateHeaderCell(ri,ci,'text',$event)"/>
      <div class="three"><a-input-number size="small" :value="cell.startColumn" @update:value="updateHeaderCell(ri,ci,'startColumn',Number($event)||0)" :min="0"/><a-input-number size="small" :value="cell.colSpan" @update:value="updateHeaderCell(ri,ci,'colSpan',Number($event)||1)" :min="1"/><a-input-number size="small" :value="cell.rowSpan" @update:value="updateHeaderCell(ri,ci,'rowSpan',Number($event)||1)" :min="1"/></div>
      <small>起始列 / 跨列 / 跨行</small><a-button size="small" danger block @click="removeHeaderCell(ri,ci)">删除单元格</a-button>
    </div>
  </div>

  <a-divider/>
  <strong>明细单元格合并 / 拆分</strong>
  <div class="merge-form"><a-input-number v-model:value="mergeForm.row" :min="0"/><a-input-number v-model:value="mergeForm.column" :min="0"/><a-input-number v-model:value="mergeForm.rowSpan" :min="1"/><a-input-number v-model:value="mergeForm.colSpan" :min="1"/></div>
  <small>行 / 列 / 跨行 / 跨列（从 0 开始）</small>
  <a-button size="small" block style="margin-top:5px" @click="addMerge">新增合并</a-button>
  <div class="merge-list"><div v-for="(merge,index) in model.merges||[]" :key="index"><span>R{{merge.row}} C{{merge.column}} · {{merge.rowSpan}}×{{merge.colSpan}}</span><a-button size="small" danger @click="removeMerge(index)">拆分</a-button></div></div>

  <a-divider/>
  <div class="two">
    <a-form-item label="行高 mm"><a-input-number v-model:value="model.rowHeight" :min="3"/></a-form-item>
    <a-form-item label="每页明细行"><a-input-number v-model:value="model.pageRows" :min="1"/></a-form-item>
  </div>
  <a-form-item label="分组字段"><a-input v-model:value="model.groupBy" placeholder="例如 category"/></a-form-item>
  <a-space wrap>
    <span>跨页重复表头</span><a-switch v-model:checked="model.repeatHeader"/>
    <span>空数据隐藏</span><a-switch v-model:checked="model.hideWhenEmpty"/>
    <span>固定合计区</span><a-switch v-model:checked="model.fixedTotal"/>
    <span>本页小计</span><a-switch v-model:checked="model.showPageSubtotal"/>
    <span>总计</span><a-switch v-model:checked="model.showGrandTotal"/>
  </a-space>
</div>
</template>

<style scoped>
.table-designer{font-size:12px}.section-head{display:flex;justify-content:space-between;align-items:center;margin:7px 0}.column-card,.header-row{border:1px solid #e0eaf2;border-radius:8px;padding:7px;margin-bottom:7px;background:#fbfdff}.column-toolbar{display:flex;justify-content:space-between;margin-bottom:5px}.column-toolbar button{border:0;background:transparent;cursor:pointer}.two{display:grid;grid-template-columns:1fr 1fr;gap:5px}.three,.merge-form{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:5px}.three{grid-template-columns:repeat(3,1fr)}.three .ant-input-number,.three .ant-select,.merge-form .ant-input-number{width:100%}.header-cell{padding:6px;border-top:1px dashed #dae5ed;margin-top:5px}.header-cell small,.table-designer>small{display:block;color:#899bab;margin:3px 0}.merge-list{display:grid;gap:4px;margin-top:6px}.merge-list>div{display:flex;justify-content:space-between;align-items:center;padding:5px 7px;background:#f6f9fb;border-radius:6px}
</style>