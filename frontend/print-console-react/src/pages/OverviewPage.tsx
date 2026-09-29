import { CheckCircleOutlined, CodeOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Alert, Card, Col, Row, Space, Typography } from 'antd'
import { PageHeader } from '@/shared/components/PageHeader'

const { Text } = Typography

const foundations = [
  ['React + TypeScript strict', '已建立'],
  ['Vite + React Router', '已建立'],
  ['TanStack Query + Zustand', '已建立'],
  ['Axios + Zod', '已建立'],
  ['Ant Design React + Theme', '已建立'],
  ['Vitest + RTL + MSW', '已建立'],
] as const

export function OverviewPage() {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <PageHeader
        eyebrow="PRINT PLATFORM · REACT BASELINE"
        title="平台概览"
        description="React/TypeScript 新控制台基座已经独立可运行。旧 Vue 控制台在业务迁移完成前继续承担现有验收能力。"
      />
      <Alert
        type="info"
        showIcon
        message="迁移策略"
        description="先稳定 App Shell 和共享基础设施，再迁打印节点、打印任务、模板中心，最后迁模板设计器并删除 Vue。"
      />
      <Row gutter={[14, 14]}>
        <Col xs={24} md={8}>
          <Card className="foundation-card">
            <CodeOutlined className="foundation-icon" />
            <Text type="secondary">当前阶段</Text>
            <strong>App Shell</strong>
            <span>统一路由、Provider、Theme 与 API 边界</span>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="foundation-card">
            <CheckCircleOutlined className="foundation-icon success" />
            <Text type="secondary">下一模块</Text>
            <strong>打印节点</strong>
            <span>作为第一个完整 React Feature 验证标准</span>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="foundation-card">
            <SafetyCertificateOutlined className="foundation-icon" />
            <Text type="secondary">迁移原则</Text>
            <strong>不中断旧功能</strong>
            <span>功能对齐、测试通过后再切换主入口</span>
          </Card>
        </Col>
      </Row>
      <Card title="统一基线">
        <div className="baseline-grid">
          {foundations.map(([name, state]) => (
            <div key={name} className="baseline-item">
              <span>{name}</span>
              <strong>{state}</strong>
            </div>
          ))}
        </div>
      </Card>
    </Space>
  )
}
