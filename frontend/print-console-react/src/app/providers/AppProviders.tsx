import { App as AntdApp, ConfigProvider, theme } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { useUiStore } from '@/stores/use-ui-store'
import { createAntdTheme } from '@/theme/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
})

function useSystemDarkMode() {
  const [dark, setDark] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return dark
}

export function AppProviders({ children }: PropsWithChildren) {
  const themeMode = useUiStore((state) => state.themeMode)
  const systemDark = useSystemDarkMode()
  const dark = themeMode === 'dark' || (themeMode === 'system' && systemDark)

  const config = useMemo(
    () => ({
      ...createAntdTheme(),
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    }),
    [dark],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={config}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  )
}
