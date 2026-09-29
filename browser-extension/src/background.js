const AGENT='http://127.0.0.1:18181'

async function jsonRequest(path,options){
  const response=await fetch(AGENT+path,options)
  const text=await response.text()
  let data=null
  try{data=text?JSON.parse(text):null}catch{data={message:text}}
  if(!response.ok)throw new Error(data?.message||data?.error||('Agent HTTP '+response.status))
  return data
}

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.type==='PRINT_PLATFORM_HEALTH'){
    jsonRequest('/health').then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:String(error)}))
    return true
  }

  if(message?.type==='PRINT_PLATFORM_GET_JOB'){
    const jobId=message.payload?.jobId
    if(!jobId){sendResponse({ok:false,error:'jobId is required'});return false}
    jsonRequest('/jobs/'+encodeURIComponent(jobId)).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:String(error)}))
    return true
  }

  if(message?.type==='PRINT_PLATFORM_LIST_SPOOLER_JOBS'){
    const printerId=message.payload?.printerId
    if(!printerId){sendResponse({ok:false,error:'printerId is required'});return false}
    jsonRequest('/spooler/jobs?printerId='+encodeURIComponent(printerId))
      .then(data=>sendResponse({ok:true,data}))
      .catch(error=>sendResponse({ok:false,error:String(error)}))
    return true
  }


  if(message?.type==='PRINT_PLATFORM_GET_SPOOLER_BINDING'){
    const taskId=message.payload?.taskId
    if(!taskId){sendResponse({ok:false,error:'taskId is required'});return false}
    jsonRequest('/spooler/bindings/'+encodeURIComponent(taskId))
      .then(data=>sendResponse({ok:true,data}))
      .catch(error=>sendResponse({ok:false,error:String(error)}))
    return true
  }

  if(message?.type==='PRINT_PLATFORM_CONTROL_SPOOLER'){
    const taskId=message.payload?.taskId
    const action=message.payload?.action
    if(!taskId||!['pause','resume','cancel'].includes(action)){
      sendResponse({ok:false,error:'taskId and valid action are required'});return false
    }
    jsonRequest('/spooler/bindings/'+encodeURIComponent(taskId)+'/'+action,{method:'POST'})
      .then(data=>sendResponse({ok:true,data}))
      .catch(error=>sendResponse({ok:false,error:String(error)}))
    return true
  }

  if(message?.type==='PRINT_PLATFORM_LIST_PRINTERS'){
    jsonRequest('/printers').then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:String(error)}))
    return true
  }

  if(message?.type==='PRINT_PLATFORM_PRINT'){
    const payload=message.payload||{}
    const pdfMode=payload.documentKind==='PDF'
    const rawMode=payload.documentKind==='RAW'
    if(!payload.printerId||(!pdfMode&&!rawMode&&typeof payload.documentHtml!=='string')||(pdfMode&&typeof payload.documentBase64!=='string')||(rawMode&&typeof payload.rawBase64!=='string')){
      sendResponse({ok:false,error:'printerId and print document are required'})
      return false
    }
    if(!pdfMode&&payload.documentHtml.length>5_000_000){
      sendResponse({ok:false,error:'documentHtml exceeds 5 MB bridge limit'})
      return false
    }
    if(pdfMode&&payload.documentBase64.length>30_000_000){
      sendResponse({ok:false,error:'PDF exceeds bridge limit'})
      return false
    }

    jsonRequest('/print',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        mode:payload.mode||'TEST',
        taskId:payload.taskId||('TEST-'+(payload.testRunId||payload.requestId||Date.now())),
        testRunId:payload.testRunId||null,
        printerId:payload.printerId,
        title:payload.title||'Print Platform',
        documentKind:rawMode?'RAW':pdfMode?'PDF':'HTML',
        documentHtml:(pdfMode||rawMode)?null:payload.documentHtml,
        documentBase64:pdfMode?payload.documentBase64:null,
        rawLanguage:rawMode?payload.rawLanguage:null,
        rawBase64:rawMode?payload.rawBase64:null,
        pageSize:payload.pageSize||null,
        copies:Math.max(1,Math.min(99,Number(payload.copies)||1)),
        printOptions:payload.printOptions||{}
      })
    }).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:String(error)}))
    return true
  }
})
