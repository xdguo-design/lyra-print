import {
  AppstoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons'
import { Button, Layout, Menu, Segmented, Tag } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { appRoutes } from '@/app/router/route-meta'
import { useUiStore, type ThemeMode } from '@/stores/use-ui-store'
import { isLyraHubEmbedded } from '@/platform/lyra-hub'

const { Header, Sider, Content } = Layout

function selectedMenuKey(pathname: string) {
  const route = appRoutes
    .filter((item) => item.path !== '/')
    .find((item) => pathname.startsWith(item.path))
  return route?.key ?? 'overview'
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed)
  const themeMode = useUiStore((state) => state.themeMode)
  const setThemeMode = useUiStore((state) => state.setThemeMode)

  const hubEmbedded = isLyraHubEmbedded()
  const activeKey = selectedMenuKey(location.pathname)
  const activeLabel = appRoutes.find((item) => item.key === activeKey)?.label ?? '打印平台'

  return (
    <Layout className="app-shell">
      <Sider
        width={236}
        collapsedWidth={72}
        collapsed={sidebarCollapsed}
        className="app-sider"
        trigger={null}
      >
        <div className="brand">
          <div className="brand-mark">印</div>
          {!sidebarCollapsed && (
            <div>
              <strong>打印平台</strong>
              <small>Print Platform</small>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={appRoutes.map((item) => ({ key: item.key, icon: item.icon, label: item.label }))}
          onClick={({ key }) => {
            const route = appRoutes.find((item) => item.key === key)
            if (route) navigate(route.path)
          }}
        />
      </Sider>

      <Layout className="app-main">
        <Header className="app-header">
          <div className="header-left">
            <Button
              type="text"
              aria-label={sidebarCollapsed ? '展开导航' : '收起导航'}
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
            <div className="context">
              <span>{hubEmbedded ? 'Lyra Hub · 统一工作区' : '独立打印平台'}</span>
              <strong>{activeLabel}</strong>
            </div>
          </div>

          <div className="header-actions">
            <Tag icon={<AppstoreOutlined />} color={hubEmbedded ? "purple" : "blue"}>
              {hubEmbedded ? "Lyra Hub" : "React Migration"}
            </Tag>
            <Segmented
              size="small"
              value={themeMode}
              onChange={(value) => setThemeMode(value as ThemeMode)}
              options={[
                { label: <SunOutlined title="浅色" />, value: 'light' },
                { label: '自动', value: 'system' },
                { label: <MoonOutlined title="深色" />, value: 'dark' },
              ]}
            />
          </div>
        </Header>

        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
