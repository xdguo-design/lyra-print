#!/usr/bin/env node
// 模板与打印功能回归：模板维护/保存/读取、打印日志、统计一致性。
// 自包含：默认自动启动 Python/FastAPI 后端（--spawn yes）→ 执行断言 → 清理。退出码 0=全过。
import fs from 'node:fs'
import path from 'node:path'
import { spawn,spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname=path.dirname(fileURLToPath(import.meta.url))
const args=process.argv.slice(2)
function arg(name,fallback){const i=args.indexOf(name);return i>=0&&args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:fallback}
const base=arg('--base','http://127.0.0.1:18083')
const pythonBackend=arg('--python-backend',path.join(__dirname,'..','..','backend','print-platform-python'))
const results=[]
const children=[]
function report(name,ok,detail){results.push({name,ok,detail});console.log('['+(ok?'PASS':'FAIL')+'] '+name+(ok?'':' — '+detail))}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function req(pathname,opts={}){
  const r=await fetch(base+pathname,{...opts,signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json',...(opts.headers||{})}})
  const text=await r.text()
  let body=null;try{body=text?JSON.parse(text):null}catch{}
  return {status:r.status,body,text}
}
function killTreeByPort(port){
  if(process.platform!=='win32')return
  const r=spawnSync('netstat',['-ano'],{encoding:'utf8'})
  const pids=[...new Set((r.stdout||'').split('\n').filter(l=>l.includes(':'+port+' ')&&l.includes('LISTENING')).map(l=>l.trim().split(/\s+/).pop()))]
  for(const pid of pids)if(/^\d+$/.test(pid))spawnSync('taskkill',['/PID',pid,'/T','/F'])
}
async function waitHealthy(){
  for(let i=0;i<90;i++){
      try{const h=await req('/actuator/health')
      if(h.status===200&&h.body?.status==='UP')return true}catch{}
      await sleep(500)
  }
  return false
}
function deepEqual(a,b){return JSON.stringify(a)===JSON.stringify(b)}

let ownBackend=null
if(arg('--spawn','yes')==='yes'){
  const port=new URL(base).port||'8080'
  killTreeByPort(Number(port))
  const work=fs.mkdtempSync(path.join(process.env.TEMP||process.env.TMPDIR||'.','func-'))
  const dbPath=path.join(work,'func.db').replace(/\\/g,'/')
  const python=process.env.PYTHON||process.env.PYTHON3||'python'
  ownBackend=spawn(python,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',port],{
    cwd:pythonBackend,
    env:{...process.env,PRINT_DATABASE_URL:'sqlite:///'+dbPath,PRINT_SECURITY_ENABLED:'false'},
    stdio:'ignore'
  })
  children.push(ownBackend)
  if(!await waitHealthy()){console.error('backend failed to start');process.exit(1)}
}

try{
  // ========== A. 模板维护 / 保存 / 读取 ==========
  const code='lifecycle-'+Date.now()
  let r=await req('/api/templates',{method:'POST',body:JSON.stringify({code,name:'生命周期测试模板',documentType:'FORM'})})
  const t=r.body
  report('模板创建',r.status===201&&t.status==='DRAFT'&&t.draftRevision===1&&t.design?.elements?.length>0&&t.sampleData?.title,
    `status=${r.status} draftRevision=${t?.draftRevision}`)

  r=await req('/api/templates/'+t.id)
  report('模板读取(单条)',r.status===200&&r.body.id===t.id&&r.body.code===code,`status=${r.status}`)
  r=await req('/api/templates')
  report('模板读取(列表包含)',r.status===200&&r.body.some(x=>x.id===t.id),`status=${r.status}`)

  // 保存草稿：改名称 + 修改设计（新增一个元素）+ 替换样例数据
  const newDesign=JSON.parse(JSON.stringify(t.design))
  newDesign.elements.push({id:'extra',type:'TEXT',x:20,y:150,w:80,h:10,text:'自定义文本 {{patientName}}',binding:'patientName',visible:true,locked:false,fontSize:10,zIndex:9,style:{}})
  const newSample={title:'修改后的标题',patientName:'李四',patientNo:'MZ-777',date:'2026-09-21',page:1,pages:1,amount:1,totalAmount:1,items:[]}
  r=await req('/api/templates/'+t.id+'/draft',{method:'PUT',body:JSON.stringify({name:'改名后的模板',design:newDesign,sampleData:newSample})})
  const saved=r.body
  report('草稿保存',r.status===200&&saved.name==='改名后的模板'&&saved.draftRevision===2,`status=${r.status} rev=${saved?.draftRevision}`)

  r=await req('/api/templates/'+t.id)
  const roundTrip=r.status===200&&r.body.name==='改名后的模板'
    &&r.body.design.elements.length===newDesign.elements.length
    &&deepEqual(r.body.design.elements.at(-1),newDesign.elements.at(-1))
    &&r.body.sampleData.patientName==='李四'
  report('草稿读取回读一致(设计/样例持久化)',roundTrip,JSON.stringify(r.body.design.elements.length)+' elements')

  // 状态流：TESTING → REVIEWING → PUBLISHED
  await req('/api/templates/'+t.id+'/testing',{method:'POST'})
  r=await req('/api/templates/'+t.id+'/submit-review',{method:'POST'})
  const reviewOk=r.status===200&&r.body.status==='REVIEWING'
  if(!reviewOk)console.log('  submit-review 响应:',r.status,r.text.slice(0,200))
  report('状态流 标记测试→提交审核',reviewOk,`status=${r.status}`)

  r=await req('/api/templates/'+t.id+'/publish',{method:'POST',body:JSON.stringify({changeNote:'首次发布'})})
  const v1=r.body
  report('发布 v1',r.status===200&&v1.status==='PUBLISHED'&&v1.publishedVersion===1,`status=${r.status} pv=${v1?.publishedVersion}`)

  r=await req('/api/templates/'+t.id+'/versions')
  const versions=r.body
  report('版本读取(不可变快照)',r.status===200&&versions.length===1&&versions[0].versionNo===1&&versions[0].design.elements.length===newDesign.elements.length,
    `versions=${versions?.length}`)

  // 发布后再存草稿：draftRevision 前进、publishedVersion 不变
  r=await req('/api/templates/'+t.id+'/draft',{method:'PUT',body:JSON.stringify({name:'发布后草稿',design:newDesign,sampleData:newSample})})
  report('发布后草稿(修订+1,发布版本不变)',r.status===200&&r.body.draftRevision===3&&r.body.publishedVersion===1,`rev=${r.body?.draftRevision} pv=${r.body?.publishedVersion}`)

  await req('/api/templates/'+t.id+'/testing',{method:'POST'})
  await req('/api/templates/'+t.id+'/submit-review',{method:'POST'})
  r=await req('/api/templates/'+t.id+'/publish',{method:'POST',body:JSON.stringify({changeNote:'二次发布'})})
  report('发布 v2',r.status===200&&r.body.publishedVersion===2,`pv=${r.body?.publishedVersion}`)

  r=await req('/api/templates/'+t.id+'/rollback',{method:'POST',body:JSON.stringify({versionNo:1,changeNote:'回滚到 v1'})})
  const rb=r.body
  r=await req('/api/templates/'+t.id+'/versions')
  const afterRollback=r.body
  report('回滚生成不可变 v3',rb.publishedVersion===3&&afterRollback.length===3&&new Set(afterRollback.map(v=>v.versionNo)).size===3,
    `pv=${rb?.publishedVersion}`)

  r=await req('/api/templates/'+t.id+'/test-data',{method:'POST',body:JSON.stringify({inputData:{...newSample,patientName:'测试运行'}})})
  const testData=r.body
  report('JSON 测试数据运行与正式任务隔离',r.status===200&&testData.status==='SUCCESS'&&testData.target?.kind==='DRAFT'&&testData.renderData?.patientName==='测试运行',`status=${r.status} run=${testData?.testRunId}`)
  r=await req('/api/template-test-runs/'+testData.testRunId+'/render-result',{method:'POST',body:JSON.stringify({success:true,pageCount:1,elapsedMs:5,message:'functional render ok'})})
  report('测试运行渲染结果回写',r.status===200&&r.body.renderStatus==='SUCCESS'&&r.body.pageCount===1,`status=${r.status}`)
  r=await req('/api/templates/'+t.id+'/test-runs?limit=20')
  report('测试运行历史可查询',r.status===200&&r.body.some(x=>x.id===testData.testRunId&&x.testType==='PREVIEW'),`rows=${r.body?.length}`)

  r=await req('/api/templates/'+t.id+'/audit')
  const actions=r.body.map(x=>x.action)
  const need=['CREATE','SAVE_DRAFT','MARK_TESTING','SUBMIT_REVIEW','PUBLISH','ROLLBACK']
  report('审计记录完整',r.status===200&&need.every(a=>actions.includes(a)),actions.join(','))

  r=await req('/api/templates/'+t.id+'/clone',{method:'POST'})
  report('模板克隆',r.status>=200&&r.status<300&&r.body.id!==t.id&&r.body.status==='DRAFT'&&r.body.code.startsWith(code+'-COPY-'),`status=${r.status}`)

  r=await req('/api/templates',{method:'POST',body:JSON.stringify({code,name:'重复编码',documentType:'FORM'})})
  report('重复编码拒绝(400)',r.status===400,`status=${r.status}`)

  const guardedCode='guarded-'+Date.now()
  r=await req('/api/templates',{method:'POST',body:JSON.stringify({code:guardedCode,name:'状态机守卫模板',documentType:'FORM'})})
  const guarded=r.body
  r=await req('/api/templates/'+guarded.id+'/publish',{method:'POST',body:JSON.stringify({changeNote:'非法直发'})})
  report('状态机阻止 DRAFT 直接发布(409)',r.status===409&&r.body?.code==='TEMPLATE_STATE_CONFLICT',`status=${r.status} code=${r.body?.code}`)

  r=await req('/api/templates/TPL-NOT-FOUND-FUNCTIONAL')
  report('模板不存在返回 404',r.status===404&&r.body?.code==='TEMPLATE_NOT_FOUND',`status=${r.status} code=${r.body?.code}`)

  r=await req('/api/cloud-templates/status')
  report('在线模板默认关闭且不影响本地模式',r.status===200&&r.body.enabled===false&&r.body.available===false,
    JSON.stringify(r.body))
  r=await req('/api/cloud-templates')
  report('在线模板关闭时列表为空',r.status===200&&Array.isArray(r.body)&&r.body.length===0,`rows=${r.body?.length}`)
  r=await req('/api/cloud-templates/upload/'+t.id,{method:'POST'})
  report('在线模板未配置时上传返回 503',r.status===503&&r.body?.code==='CLOUD_TEMPLATE_UNAVAILABLE',
    `status=${r.status} code=${r.body?.code}`)

  r=await req('/api/runtime/capabilities')
  report('运行权限能力声明',r.status===200&&r.body.authenticationEnabled===false&&r.body.rbacEnabled===false&&r.body.productionActionsProtected===false,
    JSON.stringify(r.body))

  r=await req('/api/printers/managed-functional',{method:'PUT',body:JSON.stringify({displayName:'功能测试停用打印机',location:'CI',enabled:false,defaultPrinter:false,notes:'functional'})})
  report('打印机纳管配置保存',r.status===200&&r.body.printerId==='managed-functional'&&r.body.enabled===false,`status=${r.status}`)
  r=await req('/api/printers')
  report('打印机纳管配置读取',r.status===200&&r.body.some(x=>x.printerId==='managed-functional'&&!x.enabled),`rows=${r.body?.length}`)
  r=await req('/api/print-tasks',{method:'POST',body:JSON.stringify({templateCode:code,businessKey:'PRINTER-GUARD',printerId:'managed-functional',copies:1,inputData:newSample})})
  report('平台停用打印机阻止正式任务',r.status===400&&/停用/.test(r.body?.detail||''),`status=${r.status} detail=${r.body?.detail}`)

  // ========== B/C. 打印任务 → 日志 → 统计 ==========
  async function createTask(businessKey,printer){
    const x=await req('/api/print-tasks',{method:'POST',body:JSON.stringify({templateCode:code,businessKey,printerId:printer,copies:1,inputData:newSample})})
    if(x.status!==201)throw new Error('task create failed '+x.status)
    if(x.body?.templateVersion!==3)throw new Error('task templateVersion expected 3, got '+x.body?.templateVersion)
    return x.body
  }
  async function act(id,name,body){const x=await req('/api/print-tasks/'+id+'/'+name,{method:'POST',body:body?JSON.stringify(body):undefined});if(x.status>=300)throw new Error(name+' -> '+x.status);return x.body}

  const t1=await createTask('LOG-OK-001','a4-01')
  await act(t1.id,'queue');await act(t1.id,'start');await act(t1.id,'success')

  const t2=await createTask('LOG-FAIL-002','a4-02')
  await act(t2.id,'queue');await act(t2.id,'start');await act(t2.id,'fail',{reason:'打印机缺纸'})

  const t3=await createTask('LOG-RETRY-003','a4-03')
  await act(t3.id,'queue');await act(t3.id,'start');await act(t3.id,'fail',{reason:'卡纸'})
  await act(t3.id,'retry',{printerId:'a4-backup'})
  await act(t3.id,'queue');await act(t3.id,'start');await act(t3.id,'success')

  // 任务详情读取
  r=await req('/api/print-tasks/'+t3.id)
  report('任务详情读取(终态+尝试数)',r.status===200&&r.body.status==='SUCCESS'&&r.body.attempts===2,`status=${r.body?.status} attempts=${r.body?.attempts}`)

  r=await req('/api/print-tasks/'+t3.id+'/document')
  report('正式任务冻结文档可读取',r.status===200&&r.body.taskId===t3.id&&r.body.templateVersion===3&&r.body.renderData?.patientName==='李四',
    `status=${r.status} version=${r.body?.templateVersion}`)
  r=await req('/api/print-tasks/summary')
  report('正式任务监控汇总',r.status===200&&r.body.total>=3&&r.body.succeeded>=2&&r.body.failed>=1,
    JSON.stringify(r.body))
  r=await req('/api/print-tasks?status=FAILED&keyword=LOG-FAIL-002&limit=20')
  report('正式任务筛选',r.status===200&&r.body.length===1&&r.body[0].businessKey==='LOG-FAIL-002',
    `rows=${r.body?.length}`)

  // 打印日志（任务维度）
  r=await req('/api/print-tasks/'+t3.id+'/attempts')
  const a3=r.body
  report('打印日志-按任务查询',r.status===200&&a3.length===2
    &&a3[0].attemptNo===1&&a3[0].status==='FAILED'&&(a3[0].message||'').includes('卡纸')
    &&a3[1].attemptNo===2&&a3[1].status==='SUCCESS'&&a3[1].printerId==='a4-backup',
    JSON.stringify(a3?.map(a=>a.attemptNo+':'+a.status)))

  // 打印日志（运营查询：筛选/搜索/limit）
  r=await req('/api/reports/logs?limit=200')
  const all=r.body
  report('打印日志-运营查询',r.status===200&&all.length>=4&&all[0].createdAt>=all.at(-1).createdAt,
    `rows=${all?.length}`)
  r=await req('/api/reports/logs?status=FAILED')
  report('打印日志-按结果筛选',r.status===200&&r.body.length>=2&&r.body.every(x=>x.status==='FAILED'),`rows=${r.body?.length}`)
  r=await req('/api/reports/logs?keyword=LOG-FAIL-002')
  report('打印日志-关键词搜索',r.status===200&&r.body.length===1&&r.body[0].businessKey==='LOG-FAIL-002',`rows=${r.body?.length}`)
  r=await req('/api/reports/logs?limit=1')
  report('打印日志-limit 生效',r.status===200&&r.body.length===1,`rows=${r.body?.length}`)
  r=await req('/api/reports/logs?from=2999-01-01')
  report('打印日志-日期范围过滤',r.status===200&&r.body.length===0,`rows=${r.body?.length}`)

  // 统计一致性：汇总与明细互洽
  r=await req('/api/reports/summary')
  const s=r.body
  const logsAll=await req('/api/reports/logs?limit=500')
  const successLogs=logsAll.body.filter(x=>x.status==='SUCCESS').length
  const failedLogs=logsAll.body.filter(x=>x.status==='FAILED').length
  report('统计-尝试汇总与日志一致',r.status===200&&s.attempts===successLogs+failedLogs&&s.attempts>=4,
    `summary.attempts=${s.attempts} log SUCCESS=${successLogs} FAILED=${failedLogs}`)
  r=await req('/api/reports/printers')
  const byPrinter=r.body
  report('统计-设备维度覆盖重试换机',r.status===200&&byPrinter.some(x=>x.printerId==='a4-backup'&&x.succeeded===1),JSON.stringify(byPrinter.map(x=>x.printerId)))

  r=await req('/api/templates/'+t.id+'/disable',{method:'POST'})
  report('模板停用',r.status===200&&r.body.status==='DISABLED',`status=${r.status}`)
  r=await req('/api/templates/'+t.id+'/releases')
  report('停用后无生效发布',r.status===200&&r.body.every(x=>!x.active),JSON.stringify(r.body?.map(x=>x.active)))
}catch(e){
  report('功能测试执行',false,e.stack||String(e))
}finally{
  for(const c of children){try{c.kill('SIGTERM')}catch{}}
  if(ownBackend){await sleep(500);killTreeByPort(Number(new URL(base).port||'8080'))}
}
const failed=results.filter(x=>!x.ok)
console.log('\n功能测试: '+(results.length-failed.length)+' PASS / '+failed.length+' FAIL')
process.exit(failed.length?1:0)
