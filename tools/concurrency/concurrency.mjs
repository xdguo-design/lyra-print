#!/usr/bin/env node
// HTTP 层并发测试：针对运行中的 print-platform 后端验证三类并发不变量 + 延迟分位数。
// 用法：先启动后端（或由本脚本用 --jar 自动启动），然后 node concurrency.mjs [--base http://127.0.0.1:18080] [--jar path]
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname=path.dirname(fileURLToPath(import.meta.url))
const args=process.argv.slice(2)
function arg(name,fallback){const i=args.indexOf(name);return i>=0&&args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:fallback}
const base=arg('--base','http://127.0.0.1:18080')
const jar=arg('--jar',path.join(__dirname,'..','backend','print-platform.jar'))
const results=[]
const children=[]
function report(name,ok,detail){results.push({name,ok,detail});console.log('['+(ok?'PASS':'FAIL')+'] '+name+' — '+detail)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function request(pathname,opts={}){
  const started=Date.now()
  try{
    const r=await fetch(base+pathname,{...opts,signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json',...(opts.headers||{})}})
    const text=await r.text()
    let body=null;try{body=text?JSON.parse(text):null}catch{}
    return {status:r.status,body,text,ms:Date.now()-started}
  }catch(e){return {status:0,error:String(e),ms:Date.now()-started}}
}
function percentiles(list){
  const s=[...list].sort((a,b)=>a-b)
  const pick=p=>s[Math.min(s.length-1,Math.floor(s.length*p))]||0
  return {p50:pick(.5),p95:pick(.95),max:s[s.length-1]||0}
}
function killTreeByPort(port){
  if(process.platform!=='win32')return
  const r=spawnSync('netstat',['-ano'],{encoding:'utf8'})
  const pids=[...new Set((r.stdout||'').split('\n').filter(l=>l.includes(':'+port+' ')&&l.includes('LISTENING')).map(l=>l.trim().split(/\s+/).pop()))]
  for(const pid of pids)if(/^\d+$/.test(pid))spawnSync('taskkill',['/PID',pid,'/T','/F'])
}
async function waitHealthy(){
  for(let i=0;i<60;i++){
    let h;try{h=await request('/actuator/health')}catch{await sleep(500);continue}
    if(h.status===200&&h.body?.status==='UP')return true
    await sleep(500)
  }
  return false
}

let ownBackend=null
if(arg('--spawn','yes')==='yes'){
  const port=new URL(base).port||'8080'
  killTreeByPort(Number(port))
  ownBackend=spawn('java',['-jar',jar,'--server.port='+port,'--spring.datasource.url=jdbc:sqlite:.concurrency-test.db'],{cwd:fs.mkdtempSync(path.join(process.env.TEMP||'.','conc-')),stdio:'ignore'})
  children.push(ownBackend)
  if(!await waitHealthy()){console.error('backend failed to start');process.exit(1)}
}

try{
  // 场景 1：并发创建打印任务 — 全部成功、ID 唯一、无 5xx
  {
    const n=100
    const started=Date.now()
    const rs=await Promise.all(Array.from({length:n},(_,i)=>request('/api/print-tasks',{method:'POST',body:JSON.stringify({templateCode:'outpatient-receipt',businessKey:'CONC-'+Date.now()+'-'+i,printerId:'a4-01',copies:1})})))
    const ok=rs.filter(r=>r.status===201),ids=new Set(ok.map(r=>r.body.id)),serverErrors=rs.filter(r=>r.status>=500)
    const lat=percentiles(rs.map(r=>r.ms))
    report('并发创建 100 任务',ok.length===n&&ids.size===n&&serverErrors.length===0,
      `201=${ok.length}/${n} 唯一ID=${ids.size} 5xx=${serverErrors.length} 延迟 p50=${lat.p50}ms p95=${lat.p95}ms max=${lat.max}ms 总耗时=${Date.now()-started}ms`)
  }

  // 场景 2：同一任务并发状态竞争 — 允许合法串行转换，禁止非法跳转与 5xx
  {
    const create=await request('/api/print-tasks',{method:'POST',body:JSON.stringify({templateCode:'outpatient-receipt',businessKey:'RACE-'+Date.now(),printerId:'a4-01',copies:1})})
    const id=create.body.id
    // 先推到 QUEUED，使后续 cancel(start 亦可) 都是从 QUEUED 出发的合法竞争
    await request('/api/print-tasks/'+id+'/queue',{method:'POST'})
    const rs=await Promise.all(Array.from({length:20},(_,i)=>request('/api/print-tasks/'+id+'/'+(i%2===0?'cancel':'start'),{method:'POST'})))
    const ok=rs.filter(r=>r.status===200),conflicts=rs.filter(r=>r.status===409),serverErrors=rs.filter(r=>r.status>=500)
    const after=await request('/api/print-tasks/'+id)
    const status=after.body?.status
    const consistent=(status==='CANCELLED'&&after.body.attempts===0)||(status==='PRINTING'&&after.body.attempts===1)||(status==='SUCCESS'||status==='FAILED'||status==='WAITING_AGENT')
    report('同任务 20 并发状态竞争',serverErrors.length===0&&ok.length+conflicts.length===20&&consistent,
      `200=${ok.length} 409=${conflicts.length} 5xx=${serverErrors.length} 最终=${status} attempts=${after.body?.attempts}`)
  }

  // 场景 3：并发重复模板编码 — 恰好一个成功，其余 400/409，无 5xx
  {
    const code='conc-dup-'+Date.now()
    const rs=await Promise.all(Array.from({length:10},()=>request('/api/templates',{method:'POST',body:JSON.stringify({code,name:'并发重复编码',documentType:'FORM'})})))
    const created=rs.filter(r=>r.status===201),rejected=rs.filter(r=>r.status===400||r.status===409),serverErrors=rs.filter(r=>r.status>=500)
    report('并发重复模板编码',created.length===1&&rejected.length===9&&serverErrors.length===0,
      `201=${created.length} 400/409=${rejected.length} 5xx=${serverErrors.length}`)
  }

  // 场景 4：并发发布同一模板 — 版本号严格递增且唯一，无 5xx
  {
    const t=await request('/api/templates',{method:'POST',body:JSON.stringify({code:'conc-pub-'+Date.now(),name:'并发发布',documentType:'FORM'})})
    const tid=t.body.id
    const rs=await Promise.all(Array.from({length:6},()=>request('/api/templates/'+tid+'/publish',{method:'POST',body:JSON.stringify({changeNote:'并发发布'})})))
    const ok=rs.filter(r=>r.status===200),conflicts=rs.filter(r=>r.status===409),serverErrors=rs.filter(r=>r.status>=500)
    const vs=await request('/api/templates/'+tid+'/versions')
    const numbers=(vs.body||[]).map(v=>v.versionNo)
    report('并发发布 6 次同一模板',serverErrors.length===0&&new Set(numbers).size===numbers.length&&numbers.length===ok.length+conflicts.length,
      `200=${ok.length} 409=${conflicts.length} 5xx=${serverErrors.length} 版本号=[${numbers.sort((a,b)=>a-b).join(',')}]`)
  }

  // 场景 5：混合读写突发 — 错误率与延迟
  {
    const started=Date.now()
    const ops=[]
    for(let i=0;i<60;i++)ops.push(request('/api/templates'))
    for(let i=0;i<40;i++)ops.push(request('/api/print-tasks'))
    const rs=await Promise.all(ops)
    const errors=rs.filter(r=>r.status>=500).length
    const lat=percentiles(rs.map(r=>r.ms))
    report('100 混合读请求突发',errors===0,`5xx=${errors} p50=${lat.p50}ms p95=${lat.p95}ms max=${lat.max}ms 总耗时=${Date.now()-started}ms`)
  }
}finally{
  for(const c of children){try{c.kill('SIGTERM')}catch{}}
  if(ownBackend){await sleep(500);killTreeByPort(Number(new URL(base).port||'8080'))}
}
const failed=results.filter(r=>!r.ok)
console.log('\n并发测试: '+ (results.length-failed.length) + ' PASS / ' + failed.length + ' FAIL')
process.exit(failed.length?1:0)
