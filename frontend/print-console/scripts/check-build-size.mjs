#!/usr/bin/env node
import { readdir,stat } from 'node:fs/promises'
import path from 'node:path'

const dir=path.resolve('dist/assets')
const files=(await readdir(dir)).filter(x=>x.endsWith('.js'))
const rows=[]
for(const file of files){
  const info=await stat(path.join(dir,file))
  rows.push({file,bytes:info.size})
}
rows.sort((a,b)=>b.bytes-a.bytes)
const total=rows.reduce((n,x)=>n+x.bytes,0)
const largest=rows[0]||{file:'none',bytes:0}
const maxChunk=500_000
const maxTotal=1_600_000
console.log('JS bundle total:',(total/1024).toFixed(1),'KiB')
console.log('Largest JS chunk:',largest.file,(largest.bytes/1024).toFixed(1),'KiB')
if(largest.bytes>maxChunk){
  console.error('Largest JS chunk exceeds 500 kB budget')
  process.exit(1)
}
if(total>maxTotal){
  console.error('Total JS exceeds 1.6 MB budget')
  process.exit(1)
}
