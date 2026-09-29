import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import {
  cloneTemplate,
  createTemplate,
  getTemplate,
  disableTemplate,
  getCloudStatus,
  installCloudTemplate,
  listCloudTemplates,
  listInstallations,
  listTemplateAudit,
  listTemplateReleases,
  listTemplates,
  listTemplateVersions,
  refreshInstallationLicense,
  rollbackTemplate,
  saveTemplateDraft,
  uploadCloudTemplate,
  validateTemplate,
} from './api'
import type { CreateTemplateInput,RollbackInput } from './model'

export const templateKeys={
  all:['templates'] as const,
  detail:(id:string)=>['templates',id] as const,
  versions:(id:string)=>['templates',id,'versions'] as const,
  releases:(id:string)=>['templates',id,'releases'] as const,
  audit:(id:string)=>['templates',id,'audit'] as const,
  validation:(id:string)=>['templates',id,'validation'] as const,
  cloudStatus:['cloud-templates','status'] as const,
  cloud:['cloud-templates'] as const,
  installations:['template-installations'] as const,
}

export function useTemplates(){
  return useQuery({queryKey:templateKeys.all,queryFn:listTemplates})
}
export function useTemplate(id:string){
  return useQuery({queryKey:templateKeys.detail(id),queryFn:()=>getTemplate(id),enabled:Boolean(id)})
}
export function useTemplateVersions(id:string,enabled:boolean){
  return useQuery({queryKey:templateKeys.versions(id),queryFn:()=>listTemplateVersions(id),enabled})
}
export function useTemplateReleases(id:string,enabled:boolean){
  return useQuery({queryKey:templateKeys.releases(id),queryFn:()=>listTemplateReleases(id),enabled})
}
export function useTemplateAudit(id:string,enabled:boolean){
  return useQuery({queryKey:templateKeys.audit(id),queryFn:()=>listTemplateAudit(id),enabled})
}
export function useTemplateValidation(id:string,enabled:boolean){
  return useQuery({queryKey:templateKeys.validation(id),queryFn:()=>validateTemplate(id),enabled})
}
export function useCloudStatus(){
  return useQuery({queryKey:templateKeys.cloudStatus,queryFn:getCloudStatus,staleTime:30_000})
}
export function useCloudTemplates(enabled:boolean){
  return useQuery({queryKey:templateKeys.cloud,queryFn:listCloudTemplates,enabled,staleTime:60_000})
}
export function useInstallations(enabled:boolean){
  return useQuery({queryKey:templateKeys.installations,queryFn:listInstallations,enabled,staleTime:30_000})
}

export function useSaveTemplateDraft(){
  const client=useQueryClient()
  return useMutation({
    mutationFn:({id,input}:{id:string;input:{name:string;design:unknown;sampleData:Record<string,unknown>;dataConfig:unknown}})=>saveTemplateDraft(id,input),
    onSuccess:template=>{
      client.setQueryData(templateKeys.detail(template.id),template)
      void client.invalidateQueries({queryKey:templateKeys.all})
    },
  })
}

export function useTemplateActions(){
  const client=useQueryClient()
  const invalidate=()=>client.invalidateQueries({queryKey:templateKeys.all})
  return {
    create:useMutation({mutationFn:(input:CreateTemplateInput)=>createTemplate(input),onSuccess:invalidate}),
    clone:useMutation({mutationFn:(id:string)=>cloneTemplate(id),onSuccess:invalidate}),
    disable:useMutation({mutationFn:(id:string)=>disableTemplate(id),onSuccess:invalidate}),
    rollback:useMutation({
      mutationFn:({id,input}:{id:string;input:RollbackInput})=>rollbackTemplate(id,input),
      onSuccess:()=>{void invalidate()},
    }),
    upload:useMutation({
      mutationFn:(id:string)=>uploadCloudTemplate(id),
      onSuccess:()=>{
        void client.invalidateQueries({queryKey:templateKeys.cloud})
        void client.invalidateQueries({queryKey:templateKeys.cloudStatus})
      },
    }),
    install:useMutation({
      mutationFn:({code,versionNo}:{code:string;versionNo:number})=>installCloudTemplate(code,versionNo),
      onSuccess:()=>{
        void invalidate()
        void client.invalidateQueries({queryKey:templateKeys.installations})
      },
    }),
    refreshLicense:useMutation({
      mutationFn:(localTemplateId:string)=>refreshInstallationLicense(localTemplateId),
      onSuccess:()=>void client.invalidateQueries({queryKey:templateKeys.installations}),
    }),
  }
}
