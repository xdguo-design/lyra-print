import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'

interface UiState {
  sidebarCollapsed: boolean
  themeMode: ThemeMode
  setSidebarCollapsed: (collapsed: boolean) => void
  setThemeMode: (mode: ThemeMode) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  themeMode: 'system',
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setThemeMode: (themeMode) => set({ themeMode }),
}))
