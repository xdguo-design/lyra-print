// 报表 CSV 导出：纯函数便于单测；遵循 RFC 4180（引号转义、逗号包裹）
export function csvCell(value:unknown):string{
  const text=value==null?'':String(value)
  return /[",\n\r]/.test(text)?'"'+text.replaceAll('"','""')+'"':text
}
export function buildCsv(rows:unknown[][]):string{
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n')
}
export function downloadCsv(filename:string,rows:unknown[][]):void{
  const blob=new Blob(['\ufeff'+buildCsv(rows)],{type:'text/csv;charset=utf-8'})
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href)
}
