import { test,expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import QRCode from 'qrcode'
import { createRequire } from 'node:module'
import { buildPrintDocument } from '../src/print/print-document'

const require=createRequire(import.meta.url)
const jsBarcodePath=require.resolve('jsbarcode/dist/JsBarcode.all.min.js')

test('three-page template prints to a real three-page PDF',async({page})=>{
  const qr=await QRCode.toDataURL('OP-PRINT-TEST-001',{margin:0,width:160})
  const makePage=(pageNo:number,rows:string[])=>`
    <div class="print-page" style="width:210mm;height:297mm;padding:10mm">
      <header>门诊收费票据</header>
      <div>第 ${pageNo} / 3 页</div>
      <img alt="qr" style="width:25mm;height:25mm" src="${qr}">
      <svg class="barcode" aria-label="barcode"></svg>
      <table class="dynamic-table">
        <thead><tr><th>项目</th><th>数量</th><th>金额</th></tr></thead>
        <tbody>${rows.map((r,i)=>`<tr><td>${r}</td><td>1</td><td>${(i+1).toFixed(2)}</td></tr>`).join('')}</tbody>
        ${pageNo===3?'<tfoot><tr><td>总计</td><td></td><td>43.00</td></tr></tfoot>':''}
      </table>
    </div>`
  const pages=[
    makePage(1,Array.from({length:18},(_,i)=>'项目'+(i+1))),
    makePage(2,Array.from({length:18},(_,i)=>'项目'+(i+19))),
    makePage(3,Array.from({length:7},(_,i)=>'项目'+(i+37)))
  ]
  await page.setContent(buildPrintDocument('打印回归测试','<div class="print-pages">'+pages.join('')+'</div>'),{waitUntil:'load'})
  await page.addScriptTag({path:jsBarcodePath})
  await page.evaluate(()=>{
    document.querySelectorAll('svg.barcode').forEach((svg,index)=>{
      ;(window as any).JsBarcode(svg,'PT-20260920-00'+(index+1),{format:'CODE128',displayValue:false,margin:0,height:40,width:1})
    })
  })

  await expect(page.locator('.print-page')).toHaveCount(3)
  await expect(page.locator('.print-page').nth(1).locator('thead')).toContainText('项目')
  await expect(page.locator('.print-page').nth(2)).toContainText('第 3 / 3 页')
  await expect(page.locator('.print-page').nth(2)).toContainText('总计')
  await expect(page.locator('img[alt="qr"]').first()).toHaveAttribute('src',/^data:image\/png;base64,/)
  await expect(page.locator('svg.barcode').first().locator('rect')).not.toHaveCount(0)

  const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'0',right:'0',bottom:'0',left:'0'}})
  expect(pdf.subarray(0,4).toString()).toBe('%PDF')
  const parsed=await PDFDocument.load(pdf)
  expect(parsed.getPageCount()).toBe(3)
})
