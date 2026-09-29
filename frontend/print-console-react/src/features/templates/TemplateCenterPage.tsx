import { App,Button,Card,Col,Form,Input,Modal,Result,Row,Select,Space,Table,Tabs,Tag,Timeline } from 'antd'
import type { TableProps } from 'antd'
import { PlusOutlined,ReloadOutlined } from '@ant-design/icons'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo,useState } from 'react'
import { Controller,useForm } from 'react-hook-form'
import { useNavigate,useSearchParams } from 'react-router-dom'
import { CloudTemplateMarket } from './CloudTemplateMarket'
import {
  createTemplateInputSchema,
  type CreateTemplateInput,
  type PrintTemplate,
  type ReleaseScopeType,
  type TemplateRelease,
  type TemplateVersion,
} from './model'
import {
  useCloudStatus,
  useTemplateActions,
  useTemplateAudit,
  useTemplateReleases,
  useTemplates,
  useTemplateValidation,
  useTemplateVersions,
} from './queries'
import { ErrorState,LoadingState } from '@/shared/components/StateViews'
import { PageHeader } from '@/shared/components/PageHeader'
import './templates.css'

const statusLabel={DRAFT:'草稿',TESTING:'测试中',REVIEWING:'审核中',PUBLISHED:'已发布',DISABLED:'已停用'} as const
const statusColor={DRAFT:'blue',TESTING:'cyan',REVIEWING:'orange',PUBLISHED:'green',DISABLED:'default'} as const
const documentLabel={FORM:'普通表单',INVOICE:'发票',RECEIPT:'收据',EXPENSE_LIST:'费用清单',POS_RECEIPT:'小票',LABEL:'标签',REPORT:'多页报告'} as const

function scopeLabel(release?:TemplateRelease){
  if(!release)return '—'
  return release.scopeType==='ALL'?'全部':release.scopeType+' · '+release.scopeValues.join(', ')
}
function formatTime(value:string){return new Date(value).toLocaleString()}

export function TemplateCenterPage(){
  const {message,modal}=App.useApp()
  const navigate=useNavigate()
  const [params,setParams]=useSearchParams()
  const templatesQuery=useTemplates()
  const cloudStatusQuery=useCloudStatus()
  const actions=useTemplateActions()
  const [createOpen,setCreateOpen]=useState(false)
  const [versionsTemplate,setVersionsTemplate]=useState<PrintTemplate|null>(null)
  const [auditTemplate,setAuditTemplate]=useState<PrintTemplate|null>(null)
  const [validationTemplate,setValidationTemplate]=useState<PrintTemplate|null>(null)
  const [rollbackVersion,setRollbackVersion]=useState<TemplateVersion|null>(null)
  const [rollbackNote,setRollbackNote]=useState('')
  const [scopeType,setScopeType]=useState<ReleaseScopeType>('ALL')
  const [scopeValues,setScopeValues]=useState('')

  const tab=params.get('tab')==='cloud'?'cloud':'local'
  const templates=templatesQuery.data??[]
  const stats=useMemo(()=>({
    total:templates.length,
    published:templates.filter(x=>x.status==='PUBLISHED').length,
    drafts:templates.filter(x=>x.status==='DRAFT').length,
    reviewing:templates.filter(x=>['TESTING','REVIEWING'].includes(x.status)).length,
  }),[templates])

  const versionsQuery=useTemplateVersions(versionsTemplate?.id??'',Boolean(versionsTemplate))
  const releasesQuery=useTemplateReleases(versionsTemplate?.id??'',Boolean(versionsTemplate))
  const auditQuery=useTemplateAudit(auditTemplate?.id??'',Boolean(auditTemplate))
  const validationQuery=useTemplateValidation(validationTemplate?.id??'',Boolean(validationTemplate))

  const {control,handleSubmit,reset,formState:{errors}}=useForm<CreateTemplateInput>({
    resolver:zodResolver(createTemplateInputSchema),
    defaultValues:{code:'',name:'',documentType:'FORM'},
  })

  async function create(input:CreateTemplateInput){
    try{
      const created=await actions.create.mutateAsync(input)
      message.success('模板已创建')
      setCreateOpen(false)
      reset()
      navigate('/templates/'+encodeURIComponent(created.id)+'/design')
    }catch(error){
      message.error(error instanceof Error?error.message:'创建失败')
    }
  }

  async function clone(id:string){
    try{
      await actions.clone.mutateAsync(id)
      message.success('模板已复制')
    }catch(error){
      message.error(error instanceof Error?error.message:'复制失败')
    }
  }

  function disable(template:PrintTemplate){
    modal.confirm({
      title:'停用模板？',
      content:'停用后当前发布范围将失效，但历史版本和审计记录不会删除。',
      okText:'确认停用',
      okType:'danger',
      async onOk(){
        try{
          await actions.disable.mutateAsync(template.id)
          message.success('模板已停用')
        }catch(error){
          message.error(error instanceof Error?error.message:'停用失败')
        }
      },
    })
  }

  async function upload(template:PrintTemplate){
    try{
      await actions.upload.mutateAsync(template.id)
      message.success('当前发布版本已上传在线模板中心')
      const next=new URLSearchParams(params)
      next.set('tab','cloud')
      setParams(next,{replace:true})
    }catch(error){
      message.error(error instanceof Error?error.message:'上传在线失败')
    }
  }

  async function rollback(){
    if(!versionsTemplate||!rollbackVersion)return
    try{
      await actions.rollback.mutateAsync({
        id:versionsTemplate.id,
        input:{
          versionNo:rollbackVersion.versionNo,
          changeNote:rollbackNote.trim()||('回滚到 v'+rollbackVersion.versionNo),
          scopeType,
          scopeValues:scopeType==='ALL'?[]:scopeValues.split(/[，,\n]/).map(x=>x.trim()).filter(Boolean),
        },
      })
      message.success('已回滚并发布为新版本')
      setRollbackVersion(null)
      setVersionsTemplate(null)
    }catch(error){
      message.error(error instanceof Error?error.message:'回滚失败')
    }
  }

  const columns:TableProps<PrintTemplate>['columns']=[
    {title:'模板',width:250,render:(_,row)=><div><strong>{row.name}</strong><small className="cell-sub mono">{row.code}</small></div>},
    {title:'文档类型',width:120,render:(_,row)=>documentLabel[row.documentType]},
    {title:'状态',width:100,render:(_,row)=><Tag color={statusColor[row.status]}>{statusLabel[row.status]}</Tag>},
    {title:'草稿修订',dataIndex:'draftRevision',width:90},
    {title:'发布版本',width:90,render:(_,row)=>row.publishedVersion?'v'+row.publishedVersion:'—'},
    {title:'更新时间',width:180,render:(_,row)=>formatTime(row.updatedAt)},
    {title:'操作',width:500,fixed:'right',render:(_,row)=>(
      <Space wrap size={6}>
        <Button type="primary" size="small" onClick={()=>navigate('/templates/'+encodeURIComponent(row.id)+'/design')}>设计</Button>
        <Button size="small" loading={actions.clone.isPending} onClick={()=>void clone(row.id)}>复制</Button>
        <Button size="small" onClick={()=>setVersionsTemplate(row)}>版本 / 范围</Button>
        <Button size="small" onClick={()=>setValidationTemplate(row)}>校验</Button>
        <Button size="small" onClick={()=>setAuditTemplate(row)}>审计</Button>
        <Button size="small" disabled={row.status!=='PUBLISHED'||!cloudStatusQuery.data?.publisherEnabled} loading={actions.upload.isPending} onClick={()=>void upload(row)}>上传在线</Button>
        {row.status!=='DISABLED'&&<Button size="small" danger onClick={()=>disable(row)}>停用</Button>}
      </Space>
    )},
  ]

  if(templatesQuery.isPending)return <LoadingState label="正在加载模板中心…"/>
  if(templatesQuery.isError)return <ErrorState title="模板中心加载失败" message={templatesQuery.error.message} onRetry={()=>void templatesQuery.refetch()}/>

  return (
    <Space direction="vertical" size={16} style={{width:'100%'}}>
      <PageHeader
        eyebrow="TEMPLATE PLATFORM"
        title="模板中心"
        description="管理本地模板生命周期，并从在线模板中心安装、升级和校验商用模板。模板设计器作为下一阶段独立迁移。"
        actions={
          <Space>
            <Button icon={<ReloadOutlined/>} onClick={()=>void Promise.all([templatesQuery.refetch(),cloudStatusQuery.refetch()])}>刷新全部</Button>
            <Button type="primary" icon={<PlusOutlined/>} onClick={()=>setCreateOpen(true)}>新建本地模板</Button>
          </Space>
        }
      />

      <Row gutter={[12,12]}>
        <Col xs={24} md={12} xl={6}><Card className="template-metric"><span>本地模板</span><strong>{stats.total}</strong><small>SQLite</small></Card></Col>
        <Col xs={24} md={12} xl={6}><Card className="template-metric"><span>已发布</span><strong>{stats.published}</strong><small>可上传在线</small></Card></Col>
        <Col xs={24} md={12} xl={6}><Card className="template-metric"><span>草稿</span><strong>{stats.drafts}</strong><small>待继续设计</small></Card></Col>
        <Col xs={24} md={12} xl={6}><Card className="template-metric"><span>审核中</span><strong>{stats.reviewing}</strong><small>测试 / 审核状态</small></Card></Col>
      </Row>

      <Tabs
        activeKey={tab}
        onChange={key=>{
          const next=new URLSearchParams(params)
          if(key==='local')next.delete('tab')
          else next.set('tab','cloud')
          setParams(next,{replace:true})
        }}
        items={[
          {
            key:'local',
            label:'本地模板 · SQLite',
            children:(
              <Space direction="vertical" size={12} style={{width:'100%'}}>
                <Card className="template-info-card">
                  本地模板是唯一编辑源；草稿、测试、审核、发布、回滚和审计均保存在本地数据库。
                </Card>
                <Card className="template-table-card" styles={{body:{padding:0}}}>
                  <Table<PrintTemplate>
                    rowKey="id"
                    dataSource={templates}
                    columns={columns}
                    pagination={false}
                    scroll={{x:1400}}
                  />
                </Card>
              </Space>
            ),
          },
          {key:'cloud',label:'在线模板中心',children:<CloudTemplateMarket/>},
        ]}
      />

      <Modal
        open={createOpen}
        title="新建打印模板"
        okText="创建并进入设计器"
        confirmLoading={actions.create.isPending}
        onCancel={()=>setCreateOpen(false)}
        onOk={()=>void handleSubmit(create)()}
      >
        <Form layout="vertical">
          <Form.Item label="模板编码" validateStatus={errors.code?'error':''} help={errors.code?.message}>
            <Controller name="code" control={control} render={({field})=><Input {...field} placeholder="例如 outpatient-receipt"/>}/>
          </Form.Item>
          <Form.Item label="模板名称" validateStatus={errors.name?'error':''} help={errors.name?.message}>
            <Controller name="name" control={control} render={({field})=><Input {...field} placeholder="例如 门诊缴费票据"/>}/>
          </Form.Item>
          <Form.Item label="文档类型">
            <Controller name="documentType" control={control} render={({field})=><Select {...field} options={Object.entries(documentLabel).map(([value,label])=>({value,label}))}/>}/>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(versionsTemplate)}
        width={920}
        footer={null}
        title={(versionsTemplate?.name||'')+' · 版本与影响范围'}
        onCancel={()=>setVersionsTemplate(null)}
      >
        {versionsQuery.isPending||releasesQuery.isPending?(
          <LoadingState label="正在读取版本信息…"/>
        ):(
          <Table<TemplateVersion>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={versionsQuery.data??[]}
            columns={[
              {title:'版本',render:(_,row)=><strong>v{row.versionNo}</strong>},
              {title:'发布时间',render:(_,row)=>formatTime(row.createdAt)},
              {title:'说明',dataIndex:'changeNote',render:value=>value||'—'},
              {
                title:'生效范围',
                render:(_,row)=>{
                  const release=(releasesQuery.data??[]).find(x=>x.versionNo===row.versionNo)
                  return <Tag color={release?.active?'green':'default'}>{scopeLabel(release)}</Tag>
                },
              },
              {
                title:'操作',
                render:(_,row)=><Button size="small" onClick={()=>{
                  setRollbackVersion(row)
                  setRollbackNote('回滚到 v'+row.versionNo)
                  setScopeType('ALL')
                  setScopeValues('')
                }}>回滚到此版本</Button>,
              },
            ]}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(rollbackVersion)}
        title="回滚并发布为新版本"
        okText="确认回滚"
        confirmLoading={actions.rollback.isPending}
        onCancel={()=>setRollbackVersion(null)}
        onOk={()=>void rollback()}
      >
        <Form layout="vertical">
          <Form.Item label="回滚说明">
            <Input.TextArea rows={3} value={rollbackNote} onChange={e=>setRollbackNote(e.target.value)}/>
          </Form.Item>
          <Form.Item label="新版本生效范围">
            <Select value={scopeType} onChange={setScopeType} options={['ALL','ORG','CAMPUS','DEPARTMENT','TERMINAL'].map(value=>({value,label:value}))}/>
          </Form.Item>
          {scopeType!=='ALL'&&(
            <Form.Item label="范围值">
              <Input.TextArea rows={3} value={scopeValues} onChange={e=>setScopeValues(e.target.value)} placeholder="逗号或换行分隔"/>
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal open={Boolean(auditTemplate)} footer={null} width={850} title={(auditTemplate?.name||'')+' · 审计记录'} onCancel={()=>setAuditTemplate(null)}>
        {auditQuery.isPending?(
          <LoadingState label="正在读取审计记录…"/>
        ):(
          <Timeline items={(auditQuery.data??[]).map(item=>({
            children:<div><strong>{item.action}</strong> · {formatTime(item.createdAt)}<pre className="template-json">{JSON.stringify(item.detail,null,2)}</pre></div>,
          }))}/>
        )}
      </Modal>

      <Modal open={Boolean(validationTemplate)} footer={null} width={720} title={(validationTemplate?.name||'')+' · 模板校验'} onCancel={()=>setValidationTemplate(null)}>
        {validationQuery.isPending?(
          <LoadingState label="正在校验模板…"/>
        ):validationQuery.data&&(
          <>
            <Result status={validationQuery.data.valid?'success':'error'} title={validationQuery.data.valid?'校验通过':'存在阻断错误'}/>
            {validationQuery.data.errors.map(item=><Card key={'e'+item} size="small" className="validation-error">{item}</Card>)}
            {validationQuery.data.warnings.map(item=><Card key={'w'+item} size="small" className="validation-warning">{item}</Card>)}
          </>
        )}
      </Modal>
    </Space>
  )
}
