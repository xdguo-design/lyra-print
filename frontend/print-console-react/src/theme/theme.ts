import type { ThemeConfig } from 'antd'

export const designTokens = {
  radius: { sm: 8, md: 12, lg: 18, xl: 24 },
  semantic: {
    success: '#16a36f',
    warning: '#c8860b',
    danger: '#d84b4b',
    info: '#2475df',
    offline: '#7b8798',
  },
} as const

export function createAntdTheme(): ThemeConfig {
  return {
    token: {
      colorPrimary: '#1677ff',
      borderRadius: designTokens.radius.md,
      borderRadiusLG: designTokens.radius.lg,
      fontSize: 14,
      controlHeight: 36,
      controlHeightLG: 40,
      fontFamily:
        'Inter, "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    },
    components: {
      Menu: { itemBorderRadius: 10, itemMarginInline: 10 },
      Card: { borderRadiusLG: designTokens.radius.lg },
      Drawer: { paddingLG: 20 },
      Table: { headerBorderRadius: designTokens.radius.md },
    },
  }
}
