import { describe,expect,it,vi } from 'vitest'
import QRCode from 'qrcode'
import { buildPrintDocument,openPrintDocument,parsePageRange } from './print-document'

describe('print document',()=>{
  it('builds a self-contained printable html document',()=>{
    const html=buildPrintDocument('收费票据 <A>','<div class="print-page">第一页</div>')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<title>收费票据 &lt;A&gt;</title>')
    expect(html).toContain('@page{margin:0}')
    expect(html).toContain('page-break-after:always')
    expect(html).toContain('第一页')
  })

  it('declares explicit page size so every preview page maps to one sheet',()=>{
    const html=buildPrintDocument('票据','<div class="print-page">x</div>',{width:210,height:297})
    expect(html).toContain('@page{size:210mm 297mm}')
    expect(html).toContain('@page{margin:0}')
  })


  it('parses print page ranges and removes duplicates',()=>{
    expect(parsePageRange('',4)).toEqual([1,2,3,4])
    expect(parsePageRange('1-3,2,5',5)).toEqual([1,2,3,5])
    expect(()=>parsePageRange('0,2',4)).toThrow('页码超出范围')
    expect(()=>parsePageRange('3-2',4)).toThrow('页范围超出范围')
    expect(()=>parsePageRange('1,a',4)).toThrow('页范围格式错误')
  })


  it('applies printer calibration only to generated print pages',()=>{
    const html=buildPrintDocument(
      '套打',
      '<div class="print-page">x</div>',
      {width:210,height:297},
      {offsetXmm:1.5,offsetYmm:-2,scalePercent:99.5}
    )
    expect(html).toContain('translate(1.5mm,-2mm) scale(0.995)')
    expect(html).toContain('transform-origin:top left')
  })

  it('opens print window and invokes browser print',()=>{
    const write=vi.fn(),close=vi.fn(),focus=vi.fn(),print=vi.fn()
    const opener=vi.fn(()=>({document:{write,close},focus,print}))
    const schedule=vi.fn((callback:()=>void)=>{callback()})

    const ok=openPrintDocument('测试打印','<div class="print-page">A</div>',opener,schedule)

    expect(ok).toBe(true)
    expect(opener).toHaveBeenCalledWith('','_blank','width=1100,height=850')
    expect(write).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    expect(schedule).toHaveBeenCalledWith(expect.any(Function),350)
    expect(print).toHaveBeenCalledOnce()
  })

  it('reports popup blocking without throwing',()=>{
    expect(openPrintDocument('x','y',()=>null,()=>undefined)).toBe(false)
  })

  it('generates a real QR image payload',async()=>{
    const value=await QRCode.toDataURL('PRINT-TASK-001',{margin:0,width:128})
    expect(value.startsWith('data:image/png;base64,')).toBe(true)
    expect(value.length).toBeGreaterThan(100)
  })
})
