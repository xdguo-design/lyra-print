export const LYRA_BRIDGE_VERSION = '1.0'

export type LyraWorkspaceContext = {
  mode: 'workspace'
  appId: string
  locale: string
  theme: 'light' | 'dark'
  identity: {
    authenticated: boolean
    user: { id: string; displayName?: string } | null
    tenant: { id: string; name?: string } | null
    roles: string[]
  }
  capabilities: string[]
}

type PendingCapability = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingCapability>()
let workspaceContext: LyraWorkspaceContext | null = null

export function parseLyraHubOrigin(search: string): string | null {
  const params = new URLSearchParams(search)
  if (params.get('lyraHub') !== '1') return null
  const raw = params.get('lyraHubOrigin')
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

export function getLyraHubOrigin(): string | null {
  if (typeof window === 'undefined') return null
  return parseLyraHubOrigin(window.location.search)
}

export function isLyraHubEmbedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window && getLyraHubOrigin() !== null
}

export function getLyraWorkspaceContext(): LyraWorkspaceContext | null {
  return workspaceContext
}

export function initLyraHubBridge(
  onContext?: (context: LyraWorkspaceContext) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const hubOrigin = getLyraHubOrigin()
  if (!hubOrigin || window.parent === window) return () => undefined

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== hubOrigin) return
    const message = event.data as {
      type?: string
      version?: string
      requestId?: string
      ok?: boolean
      result?: unknown
      error?: string
      context?: LyraWorkspaceContext
    }
    if (!message || message.version !== LYRA_BRIDGE_VERSION) return

    if (message.type === 'lyra.workspace.init' && message.context?.appId === 'lyra-print') {
      workspaceContext = message.context
      document.documentElement.dataset.lyraMode = 'workspace'
      document.documentElement.lang = message.context.locale || 'zh-CN'
      onContext?.(message.context)
      return
    }

    if (message.type === 'lyra.capability.result' && message.requestId) {
      const item = pending.get(message.requestId)
      if (!item) return
      clearTimeout(item.timer)
      pending.delete(message.requestId)
      if (message.ok) item.resolve(message.result)
      else item.reject(new Error(message.error || 'Lyra Hub capability failed'))
    }
  }

  window.addEventListener('message', onMessage)
  window.parent.postMessage(
    {
      type: 'lyra.app.ready',
      version: LYRA_BRIDGE_VERSION,
      appId: 'lyra-print',
    },
    hubOrigin,
  )

  return () => window.removeEventListener('message', onMessage)
}

export function invokeLyraCapability(
  capability: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Lyra Hub bridge is not available'))
  }
  const hubOrigin = getLyraHubOrigin()
  if (!hubOrigin || window.parent === window) {
    return Promise.reject(new Error('Lyra Hub bridge is not available'))
  }

  const requestId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `lyra-${Date.now()}-${Math.random().toString(16).slice(2)}`

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('Lyra Hub capability request timed out'))
    }, 15_000)

    pending.set(requestId, { resolve, reject, timer })
    window.parent.postMessage(
      {
        type: 'lyra.capability.invoke',
        version: LYRA_BRIDGE_VERSION,
        requestId,
        capability,
        payload,
      },
      hubOrigin,
    )
  })
}
