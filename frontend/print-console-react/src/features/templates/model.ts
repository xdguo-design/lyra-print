import { z } from 'zod'

export const templateStatusSchema=z.enum(['DRAFT','TESTING','REVIEWING','PUBLISHED','DISABLED'])
export type TemplateStatus=z.infer<typeof templateStatusSchema>

export const documentTypeSchema=z.enum(['FORM','INVOICE','RECEIPT','EXPENSE_LIST','POS_RECEIPT','LABEL','REPORT'])
export type DocumentType=z.infer<typeof documentTypeSchema>

export const releaseScopeTypeSchema=z.enum(['ALL','ORG','CAMPUS','DEPARTMENT','TERMINAL'])
export type ReleaseScopeType=z.infer<typeof releaseScopeTypeSchema>

export const printTemplateSchema=z.object({
  id:z.string(),
  code:z.string(),
  name:z.string(),
  documentType:documentTypeSchema,
  status:templateStatusSchema,
  draftRevision:z.number(),
  publishedVersion:z.number().nullable().optional(),
  design:z.unknown(),
  sampleData:z.record(z.string(),z.unknown()),
  dataConfig:z.unknown(),
  createdAt:z.string(),
  updatedAt:z.string(),
})
export type PrintTemplate=z.infer<typeof printTemplateSchema>

export const templateVersionSchema=z.object({
  id:z.string(),
  templateId:z.string(),
  versionNo:z.number(),
  design:z.unknown(),
  sampleData:z.record(z.string(),z.unknown()),
  dataConfig:z.unknown(),
  changeNote:z.string().nullable().optional(),
  createdAt:z.string(),
})
export type TemplateVersion=z.infer<typeof templateVersionSchema>

export const templateReleaseSchema=z.object({
  id:z.string(),
  templateId:z.string(),
  versionNo:z.number(),
  scopeType:releaseScopeTypeSchema,
  scopeValues:z.array(z.string()),
  rollbackFromVersion:z.number().nullable().optional(),
  active:z.boolean(),
  createdAt:z.string(),
})
export type TemplateRelease=z.infer<typeof templateReleaseSchema>

export const templateAuditSchema=z.object({
  id:z.number(),
  templateId:z.string(),
  action:z.string(),
  detail:z.record(z.string(),z.unknown()),
  createdAt:z.string(),
})
export type TemplateAudit=z.infer<typeof templateAuditSchema>

export const templateValidationSchema=z.object({
  valid:z.boolean(),
  errors:z.array(z.string()),
  warnings:z.array(z.string()),
})
export type TemplateValidation=z.infer<typeof templateValidationSchema>

export const cloudTemplateCategorySchema=z.enum(['FINANCE','SALES','PURCHASE','WAREHOUSE','RETAIL','MEDICAL','LOGISTICS','OTHER'])
export type CloudTemplateCategory=z.infer<typeof cloudTemplateCategorySchema>
export const cloudAccessModelSchema=z.enum(['FREE','SUBSCRIPTION'])

export const cloudStatusSchema=z.object({
  provider:z.string(),
  enabled:z.boolean(),
  configured:z.boolean(),
  available:z.boolean(),
  publisherEnabled:z.boolean(),
  accountConfigured:z.boolean(),
  message:z.string(),
})
export type CloudStatus=z.infer<typeof cloudStatusSchema>

export const cloudTemplateSchema=z.object({
  code:z.string(),
  name:z.string(),
  documentType:documentTypeSchema,
  versionNo:z.number(),
  changeNote:z.string().nullable().optional(),
  publishedAt:z.string(),
  uploadedAt:z.string(),
  sourceInstance:z.string().nullable().optional(),
  accessModel:cloudAccessModelSchema,
  productCode:z.string().nullable().optional(),
  planCode:z.string().nullable().optional(),
  cloneAllowed:z.boolean(),
  entitled:z.boolean(),
  entitlementState:z.enum(['ACTIVE','GRACE','EXPIRED','REVOKED','MISSING']),
  category:cloudTemplateCategorySchema,
  description:z.string(),
  tags:z.array(z.string()),
  thumbnailStyle:z.string(),
  featured:z.boolean(),
  sortOrder:z.number(),
  paperLabel:z.string(),
})
export type CloudTemplate=z.infer<typeof cloudTemplateSchema>

export const cloudTemplateBundleSchema=cloudTemplateSchema.extend({
  design:z.unknown(),
  sampleData:z.record(z.string(),z.unknown()),
  dataConfig:z.unknown(),
})
export type CloudTemplateBundle=z.infer<typeof cloudTemplateBundleSchema>

export const installationSchema=z.object({
  id:z.string(),
  localTemplateId:z.string(),
  cloudTemplateCode:z.string(),
  cloudVersion:z.number(),
  origin:z.enum(['CLOUD_FREE','CLOUD_SUBSCRIPTION']),
  accountId:z.string().nullable().optional(),
  entitlementId:z.string().nullable().optional(),
  licenseState:z.enum(['ACTIVE','GRACE','EXPIRED','REVOKED']),
  cloneAllowed:z.boolean(),
  lastVerifiedAt:z.string().nullable().optional(),
  entitlementValidUntil:z.string().nullable().optional(),
  graceUntil:z.string().nullable().optional(),
  installedAt:z.string(),
  updatedAt:z.string(),
})
export type TemplateInstallation=z.infer<typeof installationSchema>

export const installationResponseSchema=z.object({
  template:printTemplateSchema,
  installation:installationSchema,
})
export type TemplateInstallationResponse=z.infer<typeof installationResponseSchema>

export const createTemplateInputSchema=z.object({
  code:z.string().trim().min(2,'模板编码至少 2 个字符').max(100),
  name:z.string().trim().min(2,'模板名称至少 2 个字符').max(160),
  documentType:documentTypeSchema,
})
export type CreateTemplateInput=z.infer<typeof createTemplateInputSchema>

export const rollbackInputSchema=z.object({
  versionNo:z.number().int().positive(),
  changeNote:z.string().trim().min(1,'请输入回滚说明'),
  scopeType:releaseScopeTypeSchema,
  scopeValues:z.array(z.string()),
})
export type RollbackInput=z.infer<typeof rollbackInputSchema>
