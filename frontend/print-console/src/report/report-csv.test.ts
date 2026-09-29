import { describe,expect,it } from 'vitest'
import { buildCsv,csvCell } from './report-csv'

describe('report csv',()=>{
  it('escapes quotes commas and newlines per RFC 4180',()=>{
    expect(csvCell('普通')).toBe('普通')
    expect(csvCell('含,逗号')).toBe('"含,逗号"')
    expect(csvCell('含"引号')).toBe('"含""引号"')
    expect(csvCell('换\n行')).toBe('"换\n行"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12.5)).toBe('12.5')
  })
  it('joins rows with CRLF',()=>{
    expect(buildCsv([['日期','数量'],['2026-09-21','3']])).toBe('日期,数量\r\n2026-09-21,3')
  })
})
