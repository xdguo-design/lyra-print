<script setup lang="ts">
import { onMounted,ref,watch } from 'vue'
import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'

const props=withDefaults(defineProps<{kind:'QR'|'BARCODE';value:string;format?:string}>(),{format:'CODE128'})
const src=ref('')

async function render(){
  const value=props.value||''
  if(!value){src.value='';return}
  if(props.kind==='QR'){
    src.value=await QRCode.toDataURL(value,{margin:0,width:320,errorCorrectionLevel:'M'})
    return
  }
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
  try{
    JsBarcode(svg,value,{format:props.format||'CODE128',displayValue:false,margin:0,height:80,width:2})
    src.value='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg))
  }catch{
    src.value=''
  }
}
watch(()=>[props.value,props.kind,props.format],render,{deep:true})
onMounted(render)
</script>
<template><img v-if="src" :src="src" class="code-image"/><span v-else class="code-error">编码内容无效</span></template>
<style scoped>.code-image{display:block;width:100%;height:100%;object-fit:contain}.code-error{font-size:10px;color:#c34d4d}</style>