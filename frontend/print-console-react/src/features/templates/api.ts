import { z } from 'zod'
import { apiClient } from '@/shared/api/client'
import {
  cloudStatusSchema,
  cloudTemplateBundleSchema,
  cloudTemplateSchema,
  createTemplateInputSchema,
  installationResponseSchema,
  installationSchema,
  printTemplateSchema,
  templateAuditSchema,
  templateReleaseSchema,
  templateValidationSchema,
  templateVersionSchema,
  type CloudStatus,
  type CloudTemplate,
  type CloudTemplateBundle,
  type CreateTemplateInput,
  type PrintTemplate,
  type RollbackInput,
  type TemplateAudit,
  type TemplateInstallation,
  type TemplateInstallationResponse,
  type TemplateRelease,
  type TemplateValidation,
  type TemplateVersion,
} from './model'

export async function listTemplates():Promise<PrintTemplate[]>{
  const response=await apiClient.get('/templates')
  return z.array(printTemplateSchema).parse(response.data)
}
export async function getTemplate(id:string):Promise<PrintTemplate>{
  const response=await apiClient.get('/templates/'+encodeURIComponent(id))
  return printTemplateSchema.parse(response.data)
}
export async function saveTemplateDraft(
  id:string,
  input:{name:string;design:unknown;sampleData:Record<string,unknown>;dataConfig:unknown},
):Promise<PrintTemplate>{
  const response=await apiClient.put('/templates/'+encodeURIComponent(id)+'/draft',input)
  return printTemplateSchema.parse(response.data)
}
export async function createTemplate(input:CreateTemplateInput):Promise<PrintTemplate>{
  const response=await apiClient.post('/templates',createTemplateInputSchema.parse(input))
  return printTemplateSchema.parse(response.data)
}
export async function cloneTemplate(id:string):Promise<PrintTemplate>{
  const response=await apiClient.post('/templates/'+encodeURIComponent(id)+'/clone')
  return printTemplateSchema.parse(response.data)
}
export async function disableTemplate(id:string):Promise<PrintTemplate>{
  const response=await apiClient.post('/templates/'+encodeURIComponent(id)+'/disable')
  return printTemplateSchema.parse(response.data)
}
export async function validateTemplate(id:string):Promise<TemplateValidation>{
  const response=await apiClient.get('/templates/'+encodeURIComponent(id)+'/validate')
  return templateValidationSchema.parse(response.data)
}
export async function listTemplateVersions(id:string):Promise<TemplateVersion[]>{
  const response=await apiClient.get('/templates/'+encodeURIComponent(id)+'/versions')
  return z.array(templateVersionSchema).parse(response.data)
}
export async function listTemplateReleases(id:string):Promise<TemplateRelease[]>{
  const response=await apiClient.get('/templates/'+encodeURIComponent(id)+'/releases')
  return z.array(templateReleaseSchema).parse(response.data)
}
export async function listTemplateAudit(id:string):Promise<TemplateAudit[]>{
  const response=await apiClient.get('/templates/'+encodeURIComponent(id)+'/audit')
  return z.array(templateAuditSchema).parse(response.data)
}
export async function rollbackTemplate(id:string,input:RollbackInput):Promise<PrintTemplate>{
  const response=await apiClient.post('/templates/'+encodeURIComponent(id)+'/rollback',{
    versionNo:input.versionNo,
    changeNote:input.changeNote,
    scope:{type:input.scopeType,values:input.scopeType==='ALL'?[]:input.scopeValues},
  })
  return printTemplateSchema.parse(response.data)
}

export async function getCloudStatus():Promise<CloudStatus>{
  const response=await apiClient.get('/cloud-templates/status')
  return cloudStatusSchema.parse(response.data)
}
export async function listCloudTemplates():Promise<CloudTemplate[]>{
  const response=await apiClient.get('/cloud-templates')
  return z.array(cloudTemplateSchema).parse(response.data)
}
export async function getCloudTemplate(code:string,versionNo:number):Promise<CloudTemplateBundle>{
  const response=await apiClient.get('/cloud-templates/'+encodeURIComponent(code)+'/versions/'+versionNo)
  return cloudTemplateBundleSchema.parse(response.data)
}
export async function listInstallations():Promise<TemplateInstallation[]>{
  const response=await apiClient.get('/template-installations')
  return z.array(installationSchema).parse(response.data)
}
export async function installCloudTemplate(code:string,versionNo:number):Promise<TemplateInstallationResponse>{
  const response=await apiClient.post('/template-installations/cloud/'+encodeURIComponent(code)+'/versions/'+versionNo)
  return installationResponseSchema.parse(response.data)
}
export async function refreshInstallationLicense(localTemplateId:string):Promise<TemplateInstallation>{
  const response=await apiClient.post('/template-installations/'+encodeURIComponent(localTemplateId)+'/refresh-license')
  return installationSchema.parse(response.data)
}
export async function uploadCloudTemplate(templateId:string):Promise<CloudTemplate>{
  const response=await apiClient.post('/cloud-templates/upload/'+encodeURIComponent(templateId),{accessModel:'FREE'})
  return cloudTemplateSchema.parse(response.data)
}
