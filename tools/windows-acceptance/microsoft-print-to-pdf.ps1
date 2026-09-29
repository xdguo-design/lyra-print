param(
  [Parameter(Mandatory=$true)][string]$InputFile,
  [Parameter(Mandatory=$true)][string]$Printer,
  [Parameter(Mandatory=$true)][int]$Copies,
  [Parameter(Mandatory=$true)][string]$OutputFile
)

$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web

if(-not (Get-Printer -Name $Printer -ErrorAction SilentlyContinue)){
  throw "Printer not found: $Printer"
}

$fullOutput=[System.IO.Path]::GetFullPath($OutputFile)
$dir=[System.IO.Path]::GetDirectoryName($fullOutput)
if($dir){New-Item -ItemType Directory -Force -Path $dir | Out-Null}
if(Test-Path $fullOutput){Remove-Item -Force $fullOutput}

$raw=Get-Content -Raw -LiteralPath $InputFile
$text=[regex]::Replace($raw,'<script[\s\S]*?</script>',' ','IgnoreCase')
$text=[regex]::Replace($text,'<style[\s\S]*?</style>',' ','IgnoreCase')
$text=[regex]::Replace($text,'<[^>]+>',' ')
$text=[System.Web.HttpUtility]::HtmlDecode($text)
$text=[regex]::Replace($text,'\s+',' ').Trim()
if(-not $text){$text="Print Platform Windows real print acceptance"}

$doc=New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName=$Printer
$doc.PrinterSettings.PrintToFile=$true
$doc.PrinterSettings.PrintFileName=$fullOutput
$doc.PrinterSettings.Copies=[int16][Math]::Max(1,$Copies)
$doc.PrintController=New-Object System.Drawing.Printing.StandardPrintController
$doc.DocumentName='Print Platform Real HTTP Acceptance'

$font=New-Object System.Drawing.Font('Arial',12)
$brush=[System.Drawing.Brushes]::Black
$handler=[System.Drawing.Printing.PrintPageEventHandler]{
  param($sender,$e)
  $nl=[Environment]::NewLine
  $content="Print Platform REAL OS PRINT"+$nl+$nl+$text
  $rect=New-Object System.Drawing.RectangleF(50,50,700,950)
  $e.Graphics.DrawString($content,$font,$brush,$rect)
  $e.HasMorePages=$false
}
$doc.add_PrintPage($handler)
try{
  $doc.Print()
}finally{
  $doc.remove_PrintPage($handler)
  $doc.Dispose()
  $font.Dispose()
}

$deadline=(Get-Date).AddSeconds(30)
while((Get-Date)-lt $deadline -and -not (Test-Path $fullOutput)){Start-Sleep -Milliseconds 250}
if(-not (Test-Path $fullOutput)){throw "Microsoft Print to PDF did not create output file: $fullOutput"}

$bytes=[System.IO.File]::ReadAllBytes($fullOutput)
if($bytes.Length -lt 1024){throw "Generated PDF too small: $($bytes.Length) bytes"}
$header=[System.Text.Encoding]::ASCII.GetString($bytes,0,[Math]::Min(5,$bytes.Length))
if(-not $header.StartsWith('%PDF-')){throw "Generated file is not a PDF: header=$header"}

Write-Output "PRINT_TO_PDF_OK path=$fullOutput bytes=$($bytes.Length)"
