#!/usr/bin/env node
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname=path.dirname(fileURLToPath(import.meta.url))
const root=path.resolve(__dirname,'..')
const work=path.join(root,'.acceptance-work')
const logs=path.join(work,'logs')
const reportPath=path.join(root,'acceptance-report.json')
const markdownPath=path.join(root,'acceptance-report.md')
const backendPort=18080, frontendPort=15173, agentPort=18181, chromePort=19222
const backendBase='http://127.0.0.1:'+backendPort
const frontendBase='http://127.0.0.1:'+frontendPort
const agentBase='http://127.0.0.1:'+agentPort
const results=[]
const children=[]
let staticServer=null
let backend=null
let agent=null
let chrome=null
let cdp=null

function now(){return new Date().toISOString()}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function addResult(name,status,detail='',extra={}){results.push({name,status,detail,...extra});console.log('['+status+'] '+name+(detail?' — '+detail:''))}
async function check(name,fn){
  const started=Date.now()
  try{
    const detail=await fn()
    addResult(name,'PASS',typeof detail==='string'?detail:JSON.stringify(detail||{}),{durationMs:Date.now()-started})
    return detail
  }catch(e){
    addResult(name,'FAIL',e?.stack||String(e),{durationMs:Date.now()-started})
    throw e
  }
}
function assert(cond,msg){if(!cond)throw new Error(msg)}
function commandVersion(cmd,args=['--version']){
  const r=spawnSync(cmd,args,{encoding:'utf8',timeout:8000,windowsHide:true})
  if(r.error)throw r.error
  return (r.stdout||r.stderr||'').trim().split('\n').slice(0,2).join(' | ')
}
function chromiumVersion(){
  if(process.platform!=='win32')return commandVersion(process.env.CHROMIUM_BIN||'chromium',['--version'])
  const bin=process.env.CHROMIUM_BIN
  if(!bin)return 'CHROMIUM_BIN not set'
  const r=spawnSync('powershell',['-NoProfile','-Command','(Get-Item "'+bin+'").VersionInfo.ProductVersion'],{encoding:'utf8',timeout:15000,windowsHide:true})
  if(r.error)throw r.error
  const v=(r.stdout||'').trim()
  assert(v,'cannot read browser version from '+bin)
  return bin+' '+v
}
function spawnLogged(name,cmd,args,options={}){
  const out=fs.openSync(path.join(logs,name+'.log'),'a')
  const child=spawn(cmd,args,{...options,stdio:['ignore',out,out]})
  children.push(child)
  return child
}
function hardKill(child){
  if(process.platform==='win32'&&child.pid){
    spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'])
  }else child.kill('SIGKILL')
}
async function stopChild(child){
  if(!child||child.exitCode!==null)return
  child.kill('SIGTERM')
  for(let i=0;i<30&&child.exitCode===null;i++)await sleep(100)
  if(child.exitCode===null)hardKill(child)
  for(let i=0;i<30&&child.exitCode===null;i++)await sleep(100)
}
async function waitHttp(url,{timeout=30000,status=200}={}){
  const end=Date.now()+timeout
  let last=''
  while(Date.now()<end){
    try{
      const r=await fetch(url)
      last=r.status+' '+await r.text()
      if(r.status===status)return r
    }catch(e){last=String(e)}
    await sleep(250)
  }
  throw new Error('timeout waiting '+url+'; last='+last)
}
async function json(url,options={}){
  const r=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}})
  const text=await r.text()
  let body=text
  try{body=text?JSON.parse(text):null}catch{}
  return {status:r.status,body,text,headers:r.headers}
}
function mime(file){
  const ext=path.extname(file).toLowerCase()
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'})[ext]||'application/octet-stream'
}
function startStaticServer(){
  const dist=path.join(root,'frontend')
  staticServer=http.createServer(async(req,res)=>{
    const url=new URL(req.url||'/',frontendBase)
    if(url.pathname.startsWith('/api')||url.pathname.startsWith('/actuator')){
      const opts={hostname:'127.0.0.1',port:backendPort,path:url.pathname+url.search,method:req.method,headers:{...req.headers,host:'127.0.0.1:'+backendPort}}
      const proxy=http.request(opts,up=>{
        res.writeHead(up.statusCode||502,up.headers);up.pipe(res)
      })
      proxy.on('error',err=>{res.statusCode=502;res.end(JSON.stringify({error:'backend_unavailable',detail:err.message}))})
      req.pipe(proxy);return
    }
    let rel=decodeURIComponent(url.pathname)
    if(rel==='/'||rel==='')rel='/index.html'
    let file=path.normalize(path.join(dist,rel))
    if(!file.startsWith(dist)){res.statusCode=403;res.end('forbidden');return}
    try{
      const stat=await fsp.stat(file)
      if(stat.isDirectory())file=path.join(file,'index.html')
      const data=await fsp.readFile(file)
      res.setHeader('content-type',mime(file));res.end(data)
    }catch{
      try{res.setHeader('content-type','text/html; charset=utf-8');res.end(await fsp.readFile(path.join(dist,'index.html')))}
      catch{res.statusCode=404;res.end('not found')}
    }
  })
  return new Promise((resolve,reject)=>{
    staticServer.once('error',reject)
    staticServer.listen(frontendPort,'127.0.0.1',resolve)
  })
}
function resolvePython(){
  if(process.env.PYTHON_BIN)return process.env.PYTHON_BIN
  const candidates=process.platform==='win32'?['python','py']:['python3','python']
  for(const cmd of candidates){
    const args=cmd==='py'?['-3','--version']:['--version']
    const r=spawnSync(cmd,args,{encoding:'utf8',timeout:8000,windowsHide:true})
    if(!r.error&&r.status===0)return cmd
  }
  throw new Error('Python 3.11+ not found')
}
function venvPython(venv){
  return process.platform==='win32'?path.join(venv,'Scripts','python.exe'):path.join(venv,'bin','python')
}
async function ensureBackendVenv(){
  const venv=path.join(work,'backend-venv')
  const py=resolvePython()
  const createArgs=py==='py'?['-3','-m','venv',venv]:['-m','venv',venv]
  let r=spawnSync(py,createArgs,{encoding:'utf8',timeout:120000,windowsHide:true})
  assert(r.status===0,'cannot create backend venv: '+(r.stderr||r.stdout||r.error))
  const vpy=venvPython(venv)
  const wheelhouse=path.join(root,'backend','wheelhouse')
  r=spawnSync(vpy,['-m','pip','install','--no-index','--find-links',wheelhouse,'print-platform==0.3.0'],{encoding:'utf8',timeout:120000,windowsHide:true})
  assert(r.status===0,'cannot install offline Python backend: '+(r.stderr||r.stdout||r.error))
  return vpy
}
async function startBackend(){
  const db=path.join(work,'print-platform.db')
  const vpy=await ensureBackendVenv()
  const dbPath=path.resolve(db).replaceAll('\\\\','/')
  backend=spawnLogged('backend',vpy,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(backendPort)],{
    cwd:work,
    env:{...process.env,PRINT_DATABASE_URL:'sqlite:///'+dbPath}
  })
  await waitHttp(backendBase+'/actuator/health',{timeout:45000})
  return backend
}
async function startAgent(){
  agent=spawnLogged('agent',process.execPath,[path.join(root,'print-agent','dist','index.js')],{cwd:work,env:{...process.env,PRINT_AGENT_PORT:String(agentPort)}})
  await waitHttp(agentBase+'/health',{timeout:15000})
  return agent
}
async function startChrome(){
  const bin=process.env.CHROMIUM_BIN||['chromium','chromium-browser','google-chrome'].find(x=>spawnSync('sh',['-lc','command -v '+x],{encoding:'utf8'}).status===0)
  assert(bin,'Chromium not found')
  const profile=path.join(work,'chrome-profile')
  chrome=spawnLogged('chromium',bin,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--remote-debugging-port='+chromePort,'--user-data-dir='+profile,'about:blank'
  ],{cwd:work,env:{...process.env}})
  await waitHttp('http://127.0.0.1:'+chromePort+'/json/version',{timeout:20000})
  return bin
}
class CDP{
  constructor(wsUrl){this.wsUrl=wsUrl;this.id=0;this.pending=new Map();this.handlers=new Map()}
  async connect(){
    this.ws=new WebSocket(this.wsUrl)
    await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject})
    this.ws.onmessage=e=>{
      const m=JSON.parse(e.data)
      if(m.id&&this.pending.has(m.id)){
        const {resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id)
        if(m.error)reject(new Error(JSON.stringify(m.error)));else resolve(m.result)
        return
      }
      for(const handler of this.handlers.get(m.method)||[])Promise.resolve(handler(m.params)).catch(err=>console.error('CDP event error',m.method,err))
    }
  }
  on(method,handler){const list=this.handlers.get(method)||[];list.push(handler);this.handlers.set(method,list)}
  send(method,params={}){
    const id=++this.id
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject})
      this.ws.send(JSON.stringify({id,method,params}))
    })
  }
  async eval(expression){
    const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true})
    if(r.exceptionDetails)throw new Error('browser eval failed: '+JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }
  close(){try{this.ws?.close()}catch{}}
}
async function newPage(url='about:blank'){
  const r=await fetch('http://127.0.0.1:'+chromePort+'/json/new?'+encodeURIComponent(url),{method:'PUT'})
  assert(r.ok,'cannot create chrome page: '+r.status)
  const target=await r.json()
  const client=new CDP(target.webSocketDebuggerUrl);await client.connect()
  await client.send('Page.enable');await client.send('Runtime.enable')
  await client.send('Log.enable').catch(()=>{})
  return {client,target}
}
async function loadFrontendIntoPage(client){
  await client.send('Runtime.addBinding',{name:'__offlineHostRequest'})
  client.on('Inspector.detached',p=>console.log('[BROWSER] inspector detached: '+JSON.stringify(p)))
  client.on('Runtime.exceptionThrown',p=>console.log('[BROWSER-EXC] '+JSON.stringify(p.exceptionDetails).slice(0,600)))
  client.on('Runtime.consoleAPICalled',p=>{if(p.type==='error'||p.type==='warning')console.log('[BROWSER-CONSOLE] '+p.type+' '+JSON.stringify(p.args?.map(a=>a.value||a.description||'')).slice(0,600))})
  client.on('Log.entryAdded',p=>{const e=p.entry||{};if(e.level==='error')console.log('[BROWSER-LOG] '+e.source+' '+e.text?.slice(0,300))})
  client.on('Runtime.bindingCalled',async params=>{
    if(params.name!=='__offlineHostRequest')return
    const req=JSON.parse(params.payload)
    let result
    try{
      const u=new URL(req.url)
      if(!u.pathname.startsWith('/api')&&!u.pathname.startsWith('/actuator'))throw new Error('unsupported browser request '+u.pathname)
      const upstream=await fetch(backendBase+u.pathname+u.search,{method:req.method||'GET',headers:req.headers||{},body:['GET','HEAD'].includes(req.method||'GET')?undefined:req.body})
      const body=await upstream.text()
      const headers={};upstream.headers.forEach((v,k)=>headers[k]=v)
      result={status:upstream.status,statusText:upstream.statusText,headers,body}
    }catch(err){result={status:502,statusText:'Bridge Error',headers:{'content-type':'application/json'},body:JSON.stringify({error:'bridge_failed',detail:String(err)})}}
    await client.send('Runtime.evaluate',{expression:'window.__offlineResolve('+JSON.stringify(req.id)+','+JSON.stringify(result)+')'})
  })
  const assets=await fsp.readdir(path.join(root,'frontend','assets'))
  const jsName=assets.find(x=>x.endsWith('.js')),cssName=assets.find(x=>x.endsWith('.css'))
  assert(jsName&&cssName,'frontend built assets missing')
  const js=(await fsp.readFile(path.join(root,'frontend','assets',jsName),'utf8')).replace('baseURL:"/api"','baseURL:"https://offline-ui.invalid/api"').replace(/<\/script/gi,'<\\/script')
  const css=await fsp.readFile(path.join(root,'frontend','assets',cssName),'utf8')
  const shim=`<script>(()=>{
    let seq=0;const pending=new Map();
    const host=window.__offlineHostRequest;
    window.__offlineResolve=(id,result)=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.resolve(result)};
    async function bridgeRequest(url,method='GET',headers={},body=null){
      const absolute=new URL(String(url),document.baseURI).href;
      const id='req-'+(++seq);
      return await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});host(JSON.stringify({id,url:absolute,method:String(method||'GET').toUpperCase(),headers,body:body==null?null:String(body)}))});
    }
    class OfflineXHR{
      constructor(){
        this.readyState=0;this.status=0;this.statusText='';this.responseText='';this.response='';this.responseURL='';
        this.timeout=0;this.withCredentials=false;this.responseType='';this.onreadystatechange=null;this.onloadend=null;this.onload=null;this.onerror=null;this.onabort=null;this.ontimeout=null;
        this._headers={};this._responseHeaders={};this._aborted=false;
        this.upload={addEventListener(){},removeEventListener(){}};
      }
      open(method,url,async=true){this._method=String(method||'GET').toUpperCase();this._url=new URL(String(url),document.baseURI).href;this._async=async!==false;this.readyState=1;this.onreadystatechange?.();}
      setRequestHeader(name,value){this._headers[String(name).toLowerCase()]=String(value)}
      getAllResponseHeaders(){return Object.entries(this._responseHeaders).map(([k,v])=>k+': '+v).join('\\r\\n')}
      getResponseHeader(name){return this._responseHeaders[String(name).toLowerCase()]??null}
      overrideMimeType(){}
      addEventListener(type,handler){this['_on_'+type]=handler}
      removeEventListener(type){delete this['_on_'+type]}
      abort(){this._aborted=true;this.readyState=0;this.onabort?.();this['_on_abort']?.()}
      async send(body=null){
        try{
          const result=await bridgeRequest(this._url,this._method,this._headers,body);
          if(this._aborted)return;
          this.status=Number(result.status||0);this.statusText=result.statusText||'';this.responseURL=this._url;
          this._responseHeaders={};for(const [k,v] of Object.entries(result.headers||{}))this._responseHeaders[String(k).toLowerCase()]=String(v);
          this.responseText=result.body||'';
          if(this.responseType==='json'){try{this.response=JSON.parse(this.responseText)}catch{this.response=null}}
          else if(!this.responseType||this.responseType==='text')this.response=this.responseText;
          else this.response=this.responseText;
          this.readyState=4;this.onreadystatechange?.();this['_on_readystatechange']?.();this.onload?.();this['_on_load']?.();this.onloadend?.();this['_on_loadend']?.();
        }catch(err){if(this._aborted)return;this.readyState=4;this.onerror?.(err);this['_on_error']?.(err);this.onloadend?.();this['_on_loadend']?.();}
      }
    }
    try{Object.defineProperty(window,'XMLHttpRequest',{value:OfflineXHR,writable:true,configurable:true})}catch{window.XMLHttpRequest=OfflineXHR}
    const NativeRequest=window.Request;
    window.Request=class OfflineRequest extends NativeRequest{constructor(input,init){if(typeof input==='string')input=new URL(input,document.baseURI).href;super(input,init)}};
    window.fetch=async(input,init={})=>{
      const isReq=typeof Request!=='undefined'&&input instanceof Request;
      const raw=isReq?input.url:String(input);
      const method=String(init.method||(isReq?input.method:'GET')||'GET').toUpperCase();
      const headers={};if(isReq)input.headers.forEach((v,k)=>headers[k]=v);new Headers(init.headers||{}).forEach((v,k)=>headers[k]=v);
      let body=init.body;if(body==null&&isReq&&!['GET','HEAD'].includes(method))body=await input.clone().text();
      const result=await bridgeRequest(raw,method,headers,body);
      return new Response(result.body||'',{status:result.status,statusText:result.statusText||'',headers:result.headers||{}})
    };
  })()</script>`
  const html='<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><base href="https://offline-ui.invalid/"><meta name="viewport" content="width=device-width,initial-scale=1"><title>打印平台控制台</title><style>'+css+'</style></head><body><div id="app"></div>'+shim+'<script type="module">'+js+'</script></body></html>'
  const tree=await client.send('Page.getFrameTree')
  await client.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html})
  await waitEval(client,`document.body.innerText.includes('平台概览')`,20000)
}

async function targets(){return await (await fetch('http://127.0.0.1:'+chromePort+'/json/list')).json()}
async function waitEval(client,expression,timeout=15000){
  const end=Date.now()+timeout
  let last
  while(Date.now()<end){
    try{last=await client.eval(expression);if(last)return last}catch{}
    await sleep(150)
  }
  throw new Error('browser condition timeout: '+expression+' last='+JSON.stringify(last))
}
const jsq=s=>JSON.stringify(s)
async function clickText(client,text,selector='button'){
  const ok=await client.eval(`(()=>{const els=[...document.querySelectorAll(${jsq(selector)})];const e=els.find(x=>x.textContent?.replace(/\\s+/g,' ').trim().includes(${jsq(text)})&&!x.disabled);if(!e)return false;e.click();return true})()`)
  assert(ok,'button/text not found: '+text)
}
async function setPlaceholder(client,placeholder,value,tag='input'){
  const ok=await client.eval(`(()=>{const e=[...document.querySelectorAll(${jsq(tag)})].find(x=>x.getAttribute('placeholder')===${jsq(placeholder)});if(!e)return false;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${jsq(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  assert(ok,'input not found: '+placeholder)
}
async function setFormTextareaByLabel(client,label,value){
  const ok=await client.eval(`(()=>{const item=[...document.querySelectorAll('.ant-form-item')].find(x=>x.querySelector('label')?.textContent?.includes(${jsq(label)}));const e=item?.querySelector('textarea');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${jsq(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  assert(ok,'textarea form item not found: '+label)
}
async function setVisibleModalTextarea(client,title,value){
  const ok=await client.eval(`(()=>{const wraps=[...document.querySelectorAll('.ant-modal-wrap')].filter(x=>getComputedStyle(x).display!=='none');const w=wraps.find(x=>x.textContent?.includes(${jsq(title)}));const e=w?.querySelector('textarea');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${jsq(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  assert(ok,'visible modal textarea not found: '+title)
}
async function clickVisibleModalPrimary(client,title){
  const ok=await client.eval(`(()=>{const wraps=[...document.querySelectorAll('.ant-modal-wrap')].filter(x=>getComputedStyle(x).display!=='none');const w=wraps.find(x=>x.textContent?.includes(${jsq(title)}));const e=w?.querySelector('.ant-modal-footer .ant-btn-primary');if(!e)return false;e.click();return true})()`)
  assert(ok,'visible modal primary not found: '+title)
}
async function createViaUi(client,code,name){
  await waitEval(client,`document.body.innerText.includes('平台概览')`)
  const menuOk=await client.eval(`(()=>{const e=[...document.querySelectorAll('.ant-menu-item')].find(x=>x.textContent?.includes('模板中心'));if(!e)return false;e.click();return true})()`)
  assert(menuOk,'template center menu missing')
  await waitEval(client,`document.body.innerText.includes('TEMPLATE PLATFORM')`)
  await clickText(client,'新建模板')
  await waitEval(client,`document.body.innerText.includes('新建打印模板')`)
  await setPlaceholder(client,'例如 outpatient-receipt',code)
  await setPlaceholder(client,'例如 门诊收费票据',name)
  await clickVisibleModalPrimary(client,'新建打印模板')
  await waitEval(client,`document.body.innerText.includes(${jsq(name)}) && !!document.querySelector('.studio-page')`,20000)
}
async function designerOperations(client,sampleData){
  const initial=await client.eval(`document.querySelectorAll('.design-el').length`)
  const addText=await client.eval(`(()=>{const s=[...document.querySelectorAll('.palette-grid button span')].find(x=>x.textContent?.trim()==='文本');if(!s)return false;s.closest('button').click();return true})()`)
  assert(addText,'palette text component missing')
  const addPage=await client.eval(`(()=>{const s=[...document.querySelectorAll('.palette-grid button span')].find(x=>x.textContent?.trim()==='页码');if(!s)return false;s.closest('button').click();return true})()`)
  assert(addPage,'palette page component missing')
  await waitEval(client,`document.querySelectorAll('.design-el').length===${initial+2}`)
  await setFormTextareaByLabel(client,'文本 / 编码内容','第 {{page}} / {{pages}} 页')
  const textLayer=await client.eval(`(()=>{const rows=[...document.querySelectorAll('.layer-row')];const r=rows.find(x=>x.textContent?.includes('TEXT · 文本'));if(!r)return false;r.click();return true})()`)
  assert(textLayer,'new text layer missing')
  await setFormTextareaByLabel(client,'文本 / 编码内容','离线验收文本')
  await clickText(client,'编辑 JSON')
  await waitEval(client,`document.body.innerText.includes('编辑样例数据 JSON')`)
  await setVisibleModalTextarea(client,'编辑样例数据 JSON',JSON.stringify(sampleData,null,2))
  await clickVisibleModalPrimary(client,'编辑样例数据 JSON')
  await clickText(client,'保存草稿')
  return {initial,final:initial+2}
}
async function openPreviewAndPrint(client,templateName){
  await clickText(client,'分页预览 / 打印')
  await waitEval(client,`document.querySelectorAll('.print-pages .print-page').length===3`,20000)
  const repeated=await client.eval(`!!document.querySelector('.print-pages .print-page:nth-child(2) thead')`)
  assert(repeated,'second page table header missing')
  const thirdPageNo=await client.eval(`document.querySelector('.print-pages .print-page:nth-child(3)')?.innerText.includes('第 3 / 3 页')`)
  assert(thirdPageNo,'page number 3/3 missing')
  const before=(await targets()).map(x=>x.id)
  await clickText(client,'打印 / 保存为 PDF')
  let target
  for(let i=0;i<60;i++){
    const list=await targets()
    target=list.find(x=>x.type==='page'&&!before.includes(x.id))
    if(target)break
    await sleep(150)
  }
  assert(target,'print popup target not created')
  const pc=new CDP(target.webSocketDebuggerUrl);await pc.connect();await pc.send('Page.enable');await pc.send('Runtime.enable')
  await waitEval(pc,`document.querySelectorAll('.print-page').length===3`,10000)
  const header2=await pc.eval(`!!document.querySelector('.print-page:nth-child(2) thead')`)
  const page3=await pc.eval(`document.querySelector('.print-page:nth-child(3)')?.innerText.includes('第 3 / 3 页')`)
  assert(header2&&page3,'print popup pagination content mismatch')
  const pdf=await pc.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0})
  const pdfPath=path.join(work,'offline-acceptance.pdf')
  await fsp.writeFile(pdfPath,Buffer.from(pdf.data,'base64'))
  pc.close()
  const info=spawnSync('pdfinfo',[pdfPath],{encoding:'utf8'})
  assert(info.status===0,'pdfinfo failed: '+info.stderr)
  const m=info.stdout.match(/^Pages:\s+(\d+)/m)
  assert(m&&Number(m[1])===3,'expected 3 PDF pages, got '+(m?.[1]||'unknown'))
  return {pdfPath,pages:Number(m[1]),bytes:(await fsp.stat(pdfPath)).size,templateName}
}
async function openTemplateFromCenter(client,name){
  // 设计器模式下侧边菜单隐藏，需先点返回按钮回到模板中心
  await client.eval(`(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('模板中心'));if(!e)return false;e.click();return true})()`)
  await waitEval(client,`document.body.innerText.includes('TEMPLATE PLATFORM')`)
  await waitEval(client,`[...document.querySelectorAll('tbody tr')].some(x=>x.textContent?.includes(${jsq(name)}))`,15000)
  const ok=await client.eval(`(()=>{const rows=[...document.querySelectorAll('tbody tr')];const row=rows.find(x=>x.textContent?.includes(${jsq(name)}));const btn=row&&[...row.querySelectorAll('button')].find(b=>b.textContent?.replace(/\\s+/g,'')==='设计');if(!btn)return false;btn.click();return true})()`)
  if(!ok){
    const rows=await client.eval(`(()=>{
      const matched=[...document.querySelectorAll('tbody tr')].filter(x=>x.textContent?.includes(${jsq(name)}))
      return JSON.stringify(matched.map(x=>[...x.querySelectorAll('button')].map(b=>b.textContent?.trim())))
    })()`)
    assert(ok,'template row not found: '+name+'; buttons='+rows)
  }
  await waitEval(client,`document.body.innerText.includes(${jsq(name)}) && !!document.querySelector('.studio-page')`,20000)
}
async function printToPdfAndVerify(client,expectedPages,tag){
  await clickText(client,'分页预览 / 打印')
  await waitEval(client,`document.querySelectorAll('.print-pages .print-page').length===${expectedPages}`,20000)
  const before=(await targets()).map(x=>x.id)
  await clickText(client,'打印 / 保存为 PDF')
  let target
  for(let i=0;i<60;i++){
    const list=await targets()
    target=list.find(x=>x.type==='page'&&!before.includes(x.id))
    if(target)break
    await sleep(150)
  }
  assert(target,'print popup target not created')
  const pc=new CDP(target.webSocketDebuggerUrl);await pc.connect();await pc.send('Page.enable');await pc.send('Runtime.enable')
  await waitEval(pc,`document.querySelectorAll('.print-page').length===${expectedPages}`,10000)
  const pdf=await pc.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0})
  const pdfPath=path.join(work,'template-print-'+tag+'.pdf')
  await fsp.writeFile(pdfPath,Buffer.from(pdf.data,'base64'))
  pc.close()
  const info=spawnSync('pdfinfo',[pdfPath],{encoding:'utf8'})
  assert(info.status===0,'pdfinfo failed: '+info.stderr)
  const m=info.stdout.match(/^Pages:\s+(\d+)/m)
  assert(m&&Number(m[1])===expectedPages,'expected '+expectedPages+' PDF pages, got '+(m?.[1]||'unknown'))
  return {pdfPath,bytes:(await fsp.stat(pdfPath)).size}
}
function killListenerOnPort(port){
  if(process.platform!=='win32')return false
  const r=spawnSync('netstat',['-ano'],{encoding:'utf8'})
  const pids=[...new Set((r.stdout||'').split('\n').filter(l=>l.includes(':'+port+' ')&&l.includes('LISTENING')).map(l=>l.trim().split(/\s+/).pop()||''))]
  let killed=false
  for(const pid of pids)if(/^\d+$/.test(pid)&&Number(pid)>0){spawnSync('taskkill',['/PID',pid,'/T','/F']);killed=true}
  return killed
}
async function stopBackend(){
  killListenerOnPort(backendPort)
  await stopChild(backend);backend=null
  for(let i=0;i<50;i++){
    try{await fetch(backendBase+'/actuator/health',{signal:AbortSignal.timeout(800)});await sleep(200)}
    catch{break}
  }
}
async function shutdown(){
  try{cdp?.close()}catch{}
  await stopChild(chrome)
  await stopChild(agent)
  await stopChild(backend)
  killListenerOnPort(backendPort)
  killListenerOnPort(agentPort)
  if(staticServer){try{staticServer.closeAllConnections?.()}catch{};await new Promise(r=>staticServer.close(()=>r()))}
}
async function writeReport(){
  const pass=results.filter(x=>x.status==='PASS').length,fail=results.filter(x=>x.status==='FAIL').length
  const report={generatedAt:now(),bundleRoot:root,summary:{pass,fail,total:results.length},results}
  await fsp.writeFile(reportPath,JSON.stringify(report,null,2))
  const lines=['# Offline Acceptance Report','','Generated: '+report.generatedAt,'','Summary: **'+pass+' PASS / '+fail+' FAIL**','','| 项目 | 结果 | 说明 |','|---|---|---|',...results.map(r=>'| '+r.name.replaceAll('|','\\|')+' | '+r.status+' | '+String(r.detail||'').replaceAll('|','\\|').replaceAll('\n',' ')+' |')]
  await fsp.writeFile(markdownPath,lines.join('\n'))
}
process.on('SIGINT',async()=>{await shutdown();process.exit(130)})
process.on('SIGTERM',async()=>{await shutdown();process.exit(143)})

let fatal=null
try{
  await fsp.rm(work,{recursive:true,force:true});await fsp.mkdir(logs,{recursive:true})
  await check('离线验收包完整性',async()=>{
    const required=['backend/wheelhouse','frontend/index.html','print-agent/dist/index.js','reports/npm-audit.json','manifest.json']
    for(const p of required)assert(fs.existsSync(path.join(root,p)),'missing '+p)
    return required.join(', ')
  })
  await check('运行环境',async()=>({
    node:commandVersion('node',['--version']),
    python:commandVersion(resolvePython(),resolvePython()==='py'?['-3','--version']:['--version']),
    chromium:await chromiumVersion(),
    pdfinfo:commandVersion('pdfinfo',['-v'])
  }))
  await check('npm audit',async()=>{
    const audit=JSON.parse(await fsp.readFile(path.join(root,'reports','npm-audit.json'),'utf8'))
    const v=audit.metadata?.vulnerabilities||{}
    assert((v.total??Object.values(v).reduce((a,b)=>a+Number(b||0),0))===0,'bundle build audit is not zero: '+JSON.stringify(v))
    return '构建时实时 npm audit 报告：0 vulnerabilities（离线沙箱校验内嵌报告）'
  })

  await check('启动后端',async()=>{await startBackend();const h=await json(backendBase+'/actuator/health');assert(h.status===200&&h.body.status==='UP','backend unhealthy');return 'FastAPI UP on '+backendPort})
  await check('启动前端',async()=>{await startStaticServer();const r=await fetch(frontendBase);const html=await r.text();assert(r.status===200&&html.includes('打印平台控制台'),'frontend dist not served');return 'dist served on '+frontendPort})
  await check('启动 Print Agent',async()=>{await startAgent();const h=await json(agentBase+'/health');assert(h.status===200&&h.body.status==='UP','agent unhealthy');return h.body})
  await check('前后端联调',async()=>{const h=await json(frontendBase+'/actuator/health');assert(h.status===200&&h.body.status==='UP','frontend proxy cannot reach backend');const t=await json(frontendBase+'/api/templates');assert(t.status===200&&Array.isArray(t.body),'frontend /api proxy failed');return 'frontend proxy -> backend API OK'})
  const chromiumBin=await check('启动 Chromium',async()=>await startChrome())
  const page=await newPage('about:blank');cdp=page.client
  await check('加载生产前端到 Chromium',async()=>{await loadFrontendIntoPage(cdp);return 'production dist injected; /api bridged through CDP Fetch to real backend'})
  const code='offline-'+Date.now(),name='离线真实验收模板'
  await check('模板设计器真实操作',async()=>{
    await createViaUi(cdp,code,name)
    const items=Array.from({length:43},(_,i)=>({name:'验收项目'+(i+1),qty:1,amount:i+1}))
    const sample={title:'离线真实验收',patientName:'张三',patientNo:'OFFLINE-001',date:'2026-09-20',page:1,pages:3,amount:946,totalAmount:946,items}
    const op=await designerOperations(cdp,sample)
    let template
    for(let i=0;i<60;i++){
      const list=await json(backendBase+'/api/templates')
      template=list.body.find(x=>x.code===code)
      if(template&&template.sampleData?.items?.length===43&&template.design?.elements?.some(e=>e.text==='离线验收文本'))break
      await sleep(200)
    }
    assert(template,'UI-created template not persisted')
    assert(template.sampleData.items.length===43,'sample data did not persist')
    assert(template.design.elements.some(e=>e.type==='PAGE'),'page component did not persist')
    globalThis.__templateId=template.id;globalThis.__templateCode=code;globalThis.__templateName=name
    return 'UI create/add TEXT+PAGE/edit JSON/save; elements '+op.initial+' -> '+op.final
  })

  await check('多页预览与真实 PDF 打印',async()=>await openPreviewAndPrint(cdp,globalThis.__templateName))

  await check('多纸型模板打印(标签 40x30 / 小票 80mm)',async()=>{
    const stamp=Date.now()
    const element=(id,type,x,y,w,h,text,fontSize)=>({id,type,x,y,w,h,text,binding:'title',visible:true,locked:false,fontSize,zIndex:1,
      style:{fontFamily:'Arial, sans-serif',fontWeight:'700',fontStyle:'normal',textDecoration:'none',color:'#17365f',background:'transparent',borderColor:'#9db3c4',borderWidth:0,textAlign:'left',verticalAlign:'middle',opacity:1,rotation:0}})
    const paper=(w,h)=>({size:'CUSTOM',width:w,height:h,orientation:'PORTRAIT',marginTop:2,marginRight:2,marginBottom:2,marginLeft:2})
    const defs=[
      {code:'label-'+stamp,name:'40x30 标签打印模板',documentType:'LABEL',design:{paper:paper(40,30),grid:true,snap:true,elements:[element('t1','TITLE',4,4,32,8,'标本标签',8)]},
        sample:{title:'标本标签',patientName:'张三'}},
      {code:'receipt-'+stamp,name:'80mm 小票打印模板',documentType:'RECEIPT',design:{paper:paper(80,160),grid:true,snap:true,elements:[element('t1','TITLE',8,6,64,10,'结算小票',10),element('a1','AMOUNT',8,120,64,10,'合计：{{totalAmount}}',10)]},
        sample:{title:'结算小票',totalAmount:'12.50'}}
    ]
    for(const d of defs){
      const created=await json(backendBase+'/api/templates',{method:'POST',body:JSON.stringify({code:d.code,name:d.name,documentType:d.documentType})})
      assert(created.status===201,'template create failed: '+created.text.slice(0,120))
      const saved=await json(backendBase+'/api/templates/'+created.body.id+'/draft',{method:'PUT',body:JSON.stringify({name:d.name,design:d.design,sampleData:d.sample})})
      assert(saved.status===200,'draft save failed: '+saved.text.slice(0,120))
    }
    for(const d of defs){
      await openTemplateFromCenter(cdp,d.name)
      await printToPdfAndVerify(cdp,1,d.code)
    }
    return defs.map(d=>d.documentType+' → 1 页 PDF').join('；')
  })

  await check('发布与不可变版本',async()=>{
    const id=globalThis.__templateId
    let r=await json(backendBase+'/api/templates/'+id+'/testing',{method:'POST'});assert(r.status===200&&r.body.status==='TESTING','testing failed')
    r=await json(backendBase+'/api/templates/'+id+'/submit-review',{method:'POST'});assert(r.status===200&&r.body.status==='REVIEWING','review failed')
    r=await json(backendBase+'/api/templates/'+id+'/publish',{method:'POST',body:JSON.stringify({changeNote:'offline v1',scope:{type:'ALL',values:[]}})});assert(r.status===200&&r.body.publishedVersion===1,'publish v1 failed')
    const v1=await json(backendBase+'/api/templates/'+id+'/versions');assert(v1.status===200&&v1.body.length===1,'v1 missing')
    const current=(await json(backendBase+'/api/templates/'+id)).body
    const design=structuredClone(current.design);const text=design.elements.find(e=>e.text==='离线验收文本');text.text='离线验收文本 V2'
    r=await json(backendBase+'/api/templates/'+id+'/draft',{method:'PUT',body:JSON.stringify({name:current.name,design,sampleData:current.sampleData})});assert(r.status===200,'save v2 draft failed')
    r=await json(backendBase+'/api/templates/'+id+'/publish',{method:'POST',body:JSON.stringify({changeNote:'offline v2',scope:{type:'CAMPUS',values:['CAMPUS-A']}})});assert(r.status===200&&r.body.publishedVersion===2,'publish v2 failed')
    const versions=(await json(backendBase+'/api/templates/'+id+'/versions')).body
    assert(versions.length===2&&versions[0].versionNo!==versions[1].versionNo,'immutable versions missing')
    return 'published v1 and v2; v2 scoped to CAMPUS-A'
  })

  await check('版本回滚',async()=>{
    const id=globalThis.__templateId
    const r=await json(backendBase+'/api/templates/'+id+'/rollback',{method:'POST',body:JSON.stringify({versionNo:1,changeNote:'offline rollback',scope:{type:'ALL',values:[]}})})
    assert(r.status===200&&r.body.publishedVersion===3,'rollback did not create v3')
    assert(r.body.design.elements.some(e=>e.text==='离线验收文本'),'rollback content mismatch')
    assert(!r.body.design.elements.some(e=>e.text==='离线验收文本 V2'),'rollback retained v2 content')
    const releases=(await json(backendBase+'/api/templates/'+id+'/releases')).body
    const active=releases.find(x=>x.active)
    assert(active&&active.versionNo===3&&active.rollbackFromVersion===1,'rollback release metadata incorrect')
    return 'v1 -> v2 -> rollback creates immutable v3'
  })

  let persistedTaskId
  await check('打印任务与状态机',async()=>{
    let r=await json(backendBase+'/api/print-tasks',{method:'POST',body:JSON.stringify({templateCode:globalThis.__templateCode,businessKey:'OFFLINE-TASK-001',printerId:'cashier-a4-02',copies:1})})
    assert(r.status===201&&r.body.status==='CREATED','task create failed');persistedTaskId=r.body.id
    r=await json(backendBase+'/api/print-tasks/'+persistedTaskId+'/queue',{method:'POST'});assert(r.body.status==='QUEUED','queue failed')
    r=await json(backendBase+'/api/print-tasks/'+persistedTaskId+'/start',{method:'POST'});assert(r.body.status==='PRINTING','start failed')
    r=await json(backendBase+'/api/print-tasks/'+persistedTaskId+'/fail',{method:'POST',body:JSON.stringify({reason:'offline simulated paper jam'})});assert(r.body.status==='FAILED','fail failed')
    r=await json(backendBase+'/api/print-tasks/'+persistedTaskId+'/retry',{method:'POST',body:JSON.stringify({printerId:'front-desk-pos-01'})});assert(r.body.status==='RETRYING','retry failed')
    r=await json(backendBase+'/api/print-tasks/'+persistedTaskId+'/queue',{method:'POST'});assert(r.body.status==='QUEUED','requeue failed')
    return 'CREATED→QUEUED→PRINTING→FAILED→RETRYING→QUEUED'
  })

  await check('Print Agent 接口',async()=>{
    const h=await json(agentBase+'/health');assert(h.status===200&&h.body.status==='UP','agent health failed')
    const printers=await json(agentBase+'/printers');assert(printers.status===200&&printers.body.length===3,'printer list failed')
    const p=await json(agentBase+'/print',{method:'POST',body:JSON.stringify({taskId:persistedTaskId,printerId:'cashier-a4-02'})})
    assert(p.status===202&&p.body.accepted===true&&p.body.taskId===persistedTaskId,'agent print failed')
    assert(String(p.body.note).includes('no operating-system print call'),'native print boundary missing')
    return 'health/printers/print 202 OK; adapter explicitly mock/native OS print not executed'
  })

  await check('异常场景',async()=>{
    let r=await json(backendBase+'/api/print-tasks',{method:'POST',body:JSON.stringify({templateCode:'bad-flow',businessKey:'BAD-'+Date.now(),printerId:'cashier-a4-02',copies:1})});assert(r.status===201,'bad-flow task create failed')
    const badId=r.body.id
    r=await json(backendBase+'/api/print-tasks/'+badId+'/start',{method:'POST'});assert(r.status===409,'invalid state transition should be 409')
    r=await json(backendBase+'/api/templates',{method:'POST',body:JSON.stringify({code:globalThis.__templateCode,name:'重复编码',documentType:'FORM'})});assert(r.status===400,'duplicate code should be 400')
    r=await json(backendBase+'/api/templates/'+globalThis.__templateId+'/publish',{method:'POST',body:JSON.stringify({changeNote:'invalid scope',scope:{type:'CAMPUS',values:[]}})});assert(r.status===400,'empty scoped publish should be 400')
    const a404=await json(agentBase+'/not-found');assert(a404.status===404,'agent unknown route should be 404')
    return 'invalid transition=409; duplicate code=400; invalid release scope=400; agent unknown=404'
  })

  await check('运营报表',async()=>{
    const s=await json(backendBase+'/api/reports/summary');assert(s.status===200&&s.body.total>=1,'report summary failed: '+JSON.stringify(s.body))
    const d=await json(backendBase+'/api/reports/daily');assert(d.status===200&&Array.isArray(d.body)&&d.body.length>=1,'report daily failed')
    const p=await json(backendBase+'/api/reports/printers');assert(p.status===200&&Array.isArray(p.body)&&p.body.length>=1,'report printers failed')
    const t=await json(backendBase+'/api/reports/templates');assert(t.status===200&&Array.isArray(t.body)&&t.body.length>=1,'report templates failed')
    const bad=await json(backendBase+'/api/reports/summary?from=bad-date');assert(bad.status===400,'invalid date should be 400')
    return 'summary total='+s.body.total+' successRate='+s.body.successRate+'% printers='+p.body.length+' templates='+t.body.length
  })

  await check('SQLite 持久化与服务重启',async()=>{
    const db=path.join(work,'print-platform.db')
    assert(fs.existsSync(db)&&(await fsp.stat(db)).size>0,'sqlite db file missing/empty')
    await stopBackend()
    const down=await json(frontendBase+'/actuator/health');assert(down.status===502,'frontend proxy should expose backend unavailable during restart')
    await startBackend()
    const t=await json(backendBase+'/api/templates/'+globalThis.__templateId);assert(t.status===200&&t.body.publishedVersion===3,'template not persisted after restart')
    assert(t.body.sampleData.items.length===43,'sample rows not persisted after restart')
    const task=await json(backendBase+'/api/print-tasks/'+persistedTaskId);assert(task.status===200&&task.body.status==='QUEUED','task not persisted after restart')
    return 'SQLite '+(await fsp.stat(db)).size+' bytes; template v3 + 43 rows + task state survived restart'
  })

  await check('审计记录',async()=>{
    const a=await json(backendBase+'/api/templates/'+globalThis.__templateId+'/audit')
    assert(a.status===200&&Array.isArray(a.body),'audit endpoint failed')
    const actions=a.body.map(x=>x.action)
    for(const x of ['CREATE','SAVE_DRAFT','MARK_TESTING','SUBMIT_REVIEW','PUBLISH','ROLLBACK'])assert(actions.includes(x),'missing audit action '+x)
    return 'audit actions: '+[...new Set(actions)].join(', ')
  })
}catch(e){fatal=e}
finally{
  await shutdown()
  await writeReport()
}
if(fatal){console.error('\nACCEPTANCE FAILED:',fatal);process.exit(1)}
console.log('\nACCEPTANCE PASSED. Report: '+reportPath)
