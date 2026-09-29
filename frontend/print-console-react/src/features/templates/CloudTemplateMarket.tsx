import { App,Button,Card,Checkbox,Drawer,Empty,Input,Select,Space,Tag } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useMemo,useState } from 'react'
import { getCloudTemplate } from './api'
import type { CloudTemplate,CloudTemplateBundle,CloudTemplateCategory,TemplateInstallation } from './model'
import { useCloudStatus,useCloudTemplates,useInstallations,useTemplateActions } from './queries'
import { ErrorState,LoadingState } from '@/shared/components/StateViews'

const categoryOptions:{value:'ALL'|CloudTemplateCategory;label:string}[]=[
  {value:'ALL',label:'全部分类'},
  {value:'FINANCE',label:'财务'},
  {value:'SALES',label:'销售'},
  {value:'PURCHASE',label:'采购'},
  {value:'WAREHOUSE',label:'仓储'},
  {value:'RETAIL',label:'零售'},
  {value:'MEDICAL',label:'医疗'},
  {value:'LOGISTICS',label:'物流'},
  {value:'OTHER',label:'其他'},
]

function installationOf(item:CloudTemplate,installations:TemplateInstallation[]){
  return installations.find(x=>x.cloudTemplateCode===item.code)
}

export function CloudTemplateMarket(){
  const {message}=App.useApp()
  const statusQuery=useCloudStatus()
  const cloudQuery=useCloudTemplates(Boolean(statusQuery.data?.available))
  const installationQuery=useInstallations(Boolean(statusQuery.data?.available))
  const actions=useTemplateActions()
  const [query,setQuery]=useState('')
  const [category,setCategory]=useState<'ALL'|CloudTemplateCategory>('ALL')
  const [access,setAccess]=useState<'ALL'|'FREE'|'SUBSCRIPTION'>('ALL')
  const [featuredOnly,setFeaturedOnly]=useState(false)
  const [preview,setPreview]=useState<CloudTemplateBundle|null>(null)
  const [previewLoading,setPreviewLoading]=useState(false)

  const items=cloudQuery.data??[]
  const installations=installationQuery.data??[]
  const filtered=useMemo(()=>{
    const keyword=query.trim().toLowerCase()
    return items.filter(item=>{
      if(category!=='ALL'&&item.category!==category)return false
      if(access!=='ALL'&&item.accessModel!==access)return false
      if(featuredOnly&&!item.featured)return false
      if(!keyword)return true
      return [item.name,item.code,item.description,...item.tags].join(' ').toLowerCase().includes(keyword)
    })
  },[items,query,category,access,featuredOnly])

  if(statusQuery.isPending)return <LoadingState label="正在检测在线模板中心…"/>
  if(statusQuery.isError)return <ErrorState title="在线模板中心状态读取失败" message={statusQuery.error.message} onRetry={()=>void statusQuery.refetch()}/>
  if(!statusQuery.data.available){
    return <Card><Empty description="在线模板中心当前不可用"/><p className="template-muted">{statusQuery.data.message}</p></Card>
  }
  if(cloudQuery.isError)return <ErrorState title="在线模板读取失败" message={cloudQuery.error.message} onRetry={()=>void cloudQuery.refetch()}/>

  async function openPreview(item:CloudTemplate){
    setPreviewLoading(true)
    try{
      setPreview(await getCloudTemplate(item.code,item.versionNo))
    }catch(error){
      message.error(error instanceof Error?error.message:'在线模板预览读取失败')
    }finally{
      setPreviewLoading(false)
    }
  }

  async function install(item:CloudTemplate){
    if(item.accessModel==='SUBSCRIPTION'&&!item.entitled){
      message.warning('当前账号没有该模板的有效订阅授权')
      return
    }
    try{
      await actions.install.mutateAsync({code:item.code,versionNo:item.versionNo})
      message.success('模板已安装或更新到本地')
    }catch(error){
      message.error(error instanceof Error?error.message:'安装失败')
    }
  }

  async function refreshLicense(item:CloudTemplate){
    const current=installationOf(item,installations)
    if(!current)return
    try{
      await actions.refreshLicense.mutateAsync(current.localTemplateId)
      message.success('授权状态已刷新')
    }catch(error){
      message.error(error instanceof Error?error.message:'授权刷新失败')
    }
  }

  return (
    <Space direction="vertical" size={14} style={{width:'100%'}}>
      <Card className="template-filter-card">
        <Space wrap size={10}>
          <Input allowClear prefix={<SearchOutlined/>} value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索模板名称、编码、标签" style={{width:300}}/>
          <Select value={category} onChange={setCategory} options={categoryOptions} style={{width:145}}/>
          <Select value={access} onChange={setAccess} options={[
            {value:'ALL',label:'全部授权'},
            {value:'FREE',label:'FREE'},
            {value:'SUBSCRIPTION',label:'PRO / 订阅'},
          ]} style={{width:145}}/>
          <Checkbox checked={featuredOnly} onChange={e=>setFeaturedOnly(e.target.checked)}>仅精选</Checkbox>
          <Button onClick={()=>{setQuery('');setCategory('ALL');setAccess('ALL');setFeaturedOnly(false)}}>重置</Button>
        </Space>
        <div className="template-filter-summary">显示 <strong>{filtered.length}</strong> / {items.length} 个在线模板 · {statusQuery.data.provider}</div>
      </Card>

      {!filtered.length?(
        <Card><Empty description="没有符合当前筛选条件的在线模板"/></Card>
      ):(
        <div className="cloud-template-grid">
          {filtered.map(item=>{
            const current=installationOf(item,installations)
            const updateAvailable=Boolean(current&&current.cloudVersion<item.versionNo)
            const blocked=item.accessModel==='SUBSCRIPTION'&&!item.entitled
            return (
              <Card key={item.code} className="cloud-template-card">
                <div className="cloud-template-thumb">
                  <span>{item.paperLabel||item.documentType}</span>
                  <strong>{item.name}</strong>
                  <small>{item.code}</small>
                </div>
                <div className="cloud-template-meta">
                  <Space wrap size={6}>
                    <Tag color={item.accessModel==='FREE'?'green':'purple'}>{item.accessModel==='FREE'?'FREE':'PRO'}</Tag>
                    {item.featured&&<Tag color="blue">精选</Tag>}
                    <Tag>{item.category}</Tag>
                    {current&&<Tag color={updateAvailable?'orange':'cyan'}>{updateAvailable?'可升级':'已安装'}</Tag>}
                  </Space>
                  <p>{item.description}</p>
                  <div className="cloud-template-tags">{item.tags.map(tag=><Tag key={tag}>{tag}</Tag>)}</div>
                  <div className="cloud-template-version">在线 v{item.versionNo}{current?' · 本地 v'+current.cloudVersion:''}</div>
                </div>
                <div className="cloud-template-actions">
                  <Button loading={previewLoading} onClick={()=>void openPreview(item)}>查看详情</Button>
                  <Button
                    type="primary"
                    disabled={blocked}
                    loading={actions.install.isPending}
                    onClick={()=>void install(item)}
                  >
                    {current?(updateAvailable?'升级到 v'+item.versionNo:'重新校验'):'安装到本地'}
                  </Button>
                  {current&&<Button onClick={()=>void refreshLicense(item)} loading={actions.refreshLicense.isPending}>刷新授权</Button>}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Drawer width={720} open={Boolean(preview)} onClose={()=>setPreview(null)} title={preview?.name||'在线模板详情'}>
        {preview&&(
          <Space direction="vertical" size={16} style={{width:'100%'}}>
            <Card size="small">
              <Space wrap>
                <Tag color={preview.accessModel==='FREE'?'green':'purple'}>{preview.accessModel==='FREE'?'FREE':'PRO'}</Tag>
                <Tag>v{preview.versionNo}</Tag>
                <Tag>{preview.paperLabel}</Tag>
                <Tag>{preview.category}</Tag>
              </Space>
              <p className="template-description">{preview.description}</p>
            </Card>
            <Card title="样例数据" size="small"><pre className="template-json">{JSON.stringify(preview.sampleData,null,2)}</pre></Card>
            <Card title="设计数据摘要" size="small"><pre className="template-json">{JSON.stringify(preview.design,null,2).slice(0,5000)}</pre></Card>
          </Space>
        )}
      </Drawer>
    </Space>
  )
}
