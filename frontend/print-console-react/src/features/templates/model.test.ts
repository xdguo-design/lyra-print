import { describe,expect,it } from 'vitest'
import {
  cloudTemplateSchema,
  createTemplateInputSchema,
  printTemplateSchema,
} from './model'

describe('template model schemas',()=>{
  it('accepts the local template list shape',()=>{
    const parsed=printTemplateSchema.parse({
      id:'TPL-1',
      code:'outpatient-receipt',
      name:'门诊缴费票据',
      documentType:'RECEIPT',
      status:'PUBLISHED',
      draftRevision:3,
      publishedVersion:2,
      design:{paper:{size:'A4'}},
      sampleData:{name:'患者'},
      dataConfig:{},
      createdAt:'2026-09-23T00:00:00Z',
      updatedAt:'2026-09-23T01:00:00Z',
    })
    expect(parsed.publishedVersion).toBe(2)
  })

  it('rejects empty create input',()=>{
    expect(createTemplateInputSchema.safeParse({code:'',name:'',documentType:'FORM'}).success).toBe(false)
  })

  it('accepts cloud entitlement metadata',()=>{
    const parsed=cloudTemplateSchema.parse({
      code:'free-a4',
      name:'A4 模板',
      documentType:'FORM',
      versionNo:1,
      publishedAt:'2026-09-23T00:00:00Z',
      uploadedAt:'2026-09-23T00:00:00Z',
      accessModel:'FREE',
      cloneAllowed:true,
      entitled:true,
      entitlementState:'ACTIVE',
      category:'OTHER',
      description:'demo',
      tags:['A4'],
      thumbnailStyle:'paper',
      featured:false,
      sortOrder:1,
      paperLabel:'A4',
    })
    expect(parsed.accessModel).toBe('FREE')
  })
})
