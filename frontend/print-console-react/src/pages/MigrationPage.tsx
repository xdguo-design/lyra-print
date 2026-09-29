import { Result } from 'antd'

interface MigrationPageProps {
  title: string
  description: string
}

export function MigrationPage({ title, description }: MigrationPageProps) {
  return (
    <Result
      status="info"
      title={title}
      subTitle={description}
      extra={<span className="migration-caption">React/TypeScript Migration Queue</span>}
    />
  )
}
