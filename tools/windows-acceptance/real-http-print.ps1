param()

$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$work=Join-Path $env:RUNNER_TEMP ('print-platform-real-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$backendLog=Join-Path $work 'backend.log'
$backendErr=Join-Path $work 'backend.err.log'
$agentLog=Join-Path $work 'agent.log'
$agentErr=Join-Path $work 'agent.err.log'
$outputPdf=Join-Path $work 'microsoft-print-to-pdf-output.pdf'
$db=Join-Path $work 'acceptance.db'
$backendPort=18080
$agentPort=18183
$backendBase="http://127.0.0.1:$backendPort"
$agentBase="http://127.0.0.1:$agentPort"
$backend=$null
$agent=$null

function Wait-Http([string]$Url,[int]$Seconds=45){
  $deadline=(Get-Date).AddSeconds($Seconds)
  do{
    try{
      $r=Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if($r.StatusCode -ge 200 -and $r.StatusCode -lt 300){return}
    }catch{}
    Start-Sleep -Milliseconds 300
  }while((Get-Date)-lt $deadline)
  throw "Timed out waiting for $Url"
}

function Json([string]$Method,[string]$Url,$Body=$null){
  $params=@{Method=$Method;Uri=$Url;UseBasicParsing=$true;Headers=@{'Content-Type'='application/json'}}
  if($null -ne $Body){$params.Body=($Body|ConvertTo-Json -Depth 30 -Compress)}
  try{
    return Invoke-RestMethod @params
  }catch{
    $resp=$_.Exception.Response
    if($resp){
      $reader=New-Object IO.StreamReader($resp.GetResponseStream())
      $detail=$reader.ReadToEnd()
      throw "$Method $Url failed: $([int]$resp.StatusCode) $detail"
    }
    throw
  }
}

try{
  $printer=Get-Printer -Name 'Microsoft Print to PDF' -ErrorAction SilentlyContinue
  if(-not $printer){
    Write-Host 'Microsoft Print to PDF missing; enabling Windows optional feature'
    & dism.exe /Online /Enable-Feature /FeatureName:Printing-PrintToPDFServices-Features /All /NoRestart | Out-Host
    Restart-Service Spooler -Force
    Start-Sleep -Seconds 2
    $printer=Get-Printer -Name 'Microsoft Print to PDF' -ErrorAction SilentlyContinue
  }
  if(-not $printer){throw 'Microsoft Print to PDF is unavailable on this Windows runner'}
  Write-Host "Printer ready: $($printer.Name)"

  $pythonBackend=Join-Path $root 'backend\print-platform-python'
  if(-not (Test-Path (Join-Path $pythonBackend 'pyproject.toml'))){throw 'Python backend missing'}
  $dbUrl='sqlite:///'+($db -replace '\\','/')
  $env:PRINT_DATABASE_URL=$dbUrl
  $backend=Start-Process -FilePath 'python' -ArgumentList @(
    '-m','uvicorn','app.main:app',
    '--host','127.0.0.1',
    '--port',"$backendPort"
  ) -WorkingDirectory $pythonBackend -RedirectStandardOutput $backendLog -RedirectStandardError $backendErr -PassThru
  Wait-Http "$backendBase/actuator/health"

  $driver=Join-Path $root 'tools\windows-acceptance\microsoft-print-to-pdf.ps1'
  $env:PRINT_AGENT_PORT="$agentPort"
  $env:PRINT_AGENT_ADAPTER='command'
  $env:PRINT_AGENT_COMMAND='powershell.exe'
  $env:PRINT_AGENT_ARGS_JSON=(@(
    '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$driver,
    '-InputFile','{file}','-Printer','{printer}','-Copies','{copies}','-OutputFile',$outputPdf
  ) | ConvertTo-Json -Compress)
  $env:PRINT_AGENT_PRINTERS_JSON='[{"id":"Microsoft Print to PDF","name":"Microsoft Print to PDF","type":"WINDOWS","status":"ONLINE","isDefault":true}]'
  $agent=Start-Process -FilePath 'node' -ArgumentList @('dist/index.js') -WorkingDirectory (Join-Path $root 'print-agent') -RedirectStandardOutput $agentLog -RedirectStandardError $agentErr -PassThru
  Wait-Http "$agentBase/health"

  $stamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $code="windows-real-$stamp"
  $template=Json 'POST' "$backendBase/api/templates" @{
    code=$code;name='Windows Real Print Acceptance';documentType='FORM'
  }
  Json 'POST' "$backendBase/api/templates/$($template.id)/testing" | Out-Null
  Json 'POST' "$backendBase/api/templates/$($template.id)/submit-review" | Out-Null
  Json 'POST' "$backendBase/api/templates/$($template.id)/publish" @{
    changeNote='windows real print acceptance';scope=@{type='ALL';values=@()}
  } | Out-Null

  $task=Json 'POST' "$backendBase/api/print-tasks" @{
    templateCode=$code;businessKey="REAL-$stamp";printerId='Microsoft Print to PDF';copies=1;
    inputData=@{
      title='Windows Real Print Acceptance'
      patientName='CI Runner'
      patientNo="REAL-$stamp"
      date=[DateTimeOffset]::UtcNow.ToString('yyyy-MM-dd')
      amount='12.34'
      totalAmount='12.34'
      items=@(@{name='Native OS Print';qty=1;amount='12.34'})
    }
  }
  Json 'POST' "$backendBase/api/print-tasks/$($task.id)/queue" | Out-Null
  Json 'POST' "$backendBase/api/print-tasks/$($task.id)/start" | Out-Null

  $document=Json 'GET' "$backendBase/api/print-tasks/$($task.id)/document"
  if($document.taskId -ne $task.id){throw 'frozen task document does not match task id'}
  $renderData=($document.renderData|ConvertTo-Json -Depth 20 -Compress)
  $html="<html><body><h1>Print Platform Real HTTP Acceptance</h1><p>Task: $($task.id)</p><p>Template: $($document.templateName)</p><pre>$renderData</pre></body></html>"

  $printed=Json 'POST' "$agentBase/print" @{
    mode='PRODUCTION';taskId=$task.id;printerId='Microsoft Print to PDF';copies=1;
    title='Windows Real Print Acceptance';documentHtml=$html;
    printOptions=@{duplexMode='SIMPLEX';colorMode='MONOCHROME';fitMode='ACTUAL';paperSource=''}
  }
  if($printed.executed -ne $true -or $printed.status -ne 'SUCCESS'){
    throw "Agent did not execute production print: $($printed|ConvertTo-Json -Compress)"
  }

  Json 'POST' "$backendBase/api/print-tasks/$($task.id)/success" | Out-Null
  $final=Json 'GET' "$backendBase/api/print-tasks/$($task.id)"
  if($final.status -ne 'SUCCESS'){throw "PrintTask did not reach SUCCESS: $($final.status)"}

  if(-not (Test-Path $outputPdf)){throw "Expected Microsoft Print to PDF output missing: $outputPdf"}
  $bytes=[IO.File]::ReadAllBytes($outputPdf)
  if($bytes.Length -lt 1024){throw "Output PDF too small: $($bytes.Length)"}
  $header=[Text.Encoding]::ASCII.GetString($bytes,0,5)
  if($header -ne '%PDF-'){throw "Output file is not PDF: $header"}

  $attempts=Json 'GET' "$backendBase/api/print-tasks/$($task.id)/attempts"
  if(-not $attempts -or $attempts[-1].status -ne 'SUCCESS'){throw 'PrintAttempt did not finish SUCCESS'}

  Write-Host "REAL_WINDOWS_PRINT_ACCEPTANCE_OK"
  Write-Host "taskId=$($task.id)"
  Write-Host "output=$outputPdf"
  $artifactDir=Join-Path $root 'artifacts\windows-real-print'
  New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
  Copy-Item -Force $outputPdf (Join-Path $artifactDir 'microsoft-print-to-pdf-output.pdf')
  @{
    taskId=$task.id
    printer='Microsoft Print to PDF'
    bytes=$bytes.Length
    generatedAt=[DateTimeOffset]::UtcNow.ToString('o')
  } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $artifactDir 'result.json')

  Write-Host "bytes=$($bytes.Length)"
} finally {
  if($agent -and -not $agent.HasExited){Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue}
  if($backend -and -not $backend.HasExited){Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue}
  Write-Host '--- backend.log ---'
  if(Test-Path $backendLog){Get-Content $backendLog -Tail 120}
  if(Test-Path $backendErr){Get-Content $backendErr -Tail 120}
  Write-Host '--- agent.log ---'
  if(Test-Path $agentLog){Get-Content $agentLog -Tail 120}
  if(Test-Path $agentErr){Get-Content $agentErr -Tail 120}
}
