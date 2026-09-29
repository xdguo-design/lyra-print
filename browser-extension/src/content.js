const SOURCE_PAGE='print-platform-page'
const SOURCE_EXTENSION='print-platform-extension'

window.addEventListener('message',event=>{
  if(event.source!==window||event.data?.source!==SOURCE_PAGE)return
  const {type,requestId,payload}=event.data||{}
  if(!requestId||!['HEALTH','LIST_PRINTERS','PRINT','GET_JOB','LIST_SPOOLER_JOBS','GET_SPOOLER_BINDING','CONTROL_SPOOLER'].includes(type))return

  const runtimeType={
    HEALTH:'PRINT_PLATFORM_HEALTH',
    LIST_PRINTERS:'PRINT_PLATFORM_LIST_PRINTERS',
    PRINT:'PRINT_PLATFORM_PRINT',
    GET_JOB:'PRINT_PLATFORM_GET_JOB',
    LIST_SPOOLER_JOBS:'PRINT_PLATFORM_LIST_SPOOLER_JOBS',
    GET_SPOOLER_BINDING:'PRINT_PLATFORM_GET_SPOOLER_BINDING',
    CONTROL_SPOOLER:'PRINT_PLATFORM_CONTROL_SPOOLER'
  }[type]
  chrome.runtime.sendMessage({type:runtimeType,payload},response=>{
    const error=chrome.runtime.lastError?.message
    window.postMessage({
      source:SOURCE_EXTENSION,
      requestId,
      response:error?{ok:false,error}:response
    },'*')
  })
})
