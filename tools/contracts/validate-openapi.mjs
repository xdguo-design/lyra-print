#!/usr/bin/env node
import fs from 'node:fs'

const path=process.argv[2]||'contracts/openapi/print-platform.yaml'
const text=fs.readFileSync(path,'utf8')
const lines=text.split(/\r?\n/)

function fail(message){console.error(message);process.exit(1)}
if(!/^openapi:\s*3\.1\.0\s*$/m.test(text))fail('openapi must be 3.1.0')

const paths=[]
const operationIds=[]
const refs=[]
const schemas=[]
let inSchemas=false

for(const line of lines){
  const indent=line.match(/^\s*/)?.[0].length||0
  const trimmed=line.trim()
  if(/^  schemas:\s*$/.test(line)){inSchemas=true;continue}
  if(inSchemas&&trimmed&&indent<=2){inSchemas=false}
  if(inSchemas){
    const m=line.match(/^    ([A-Za-z0-9_.-]+):\s*$/)
    if(m)schemas.push(m[1])
  }
  const pm=line.match(/^  (\/[^:]+):\s*$/)
  if(pm)paths.push(pm[1])
  const om=line.match(/^\s*operationId:\s*([^\s#]+)\s*$/)
  if(om)operationIds.push(om[1])
  for(const rm of line.matchAll(/\$ref:\s*['"]?#\/components\/schemas\/([A-Za-z0-9_.-]+)['"]?/g))refs.push(rm[1])
}

if(!paths.length)fail('paths must be an object with at least one route')
if(!schemas.length)fail('components.schemas must be an object with at least one schema')

const dup=[...new Set(operationIds.filter((id,i,a)=>a.indexOf(id)!==i))]
if(dup.length)fail('duplicate operationId: '+dup.join(', '))

const schemaSet=new Set(schemas)
const missing=[...new Set(refs.filter(x=>!schemaSet.has(x)))]
if(missing.length)fail('missing schema refs: '+missing.join(', '))

const bad=paths.filter(x=>!x.startsWith('/api/'))
if(bad.length)fail('unexpected non-api paths: '+bad.join(', '))

const planned=(text.match(/x-implementation-status:\s*planned\b/g)||[]).length
const version=text.match(/^\s*version:\s*([^\s#]+)\s*$/m)?.[1]||'unknown'
console.log(`OpenAPI OK: ${version}, ${paths.length} paths, ${operationIds.length} operations, ${schemas.length} schemas, ${planned} planned operations`)
