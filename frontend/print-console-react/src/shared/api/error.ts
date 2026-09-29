import axios from 'axios'

export class ApiError extends Error {
  readonly code: string
  readonly status?: number
  readonly requestId?: string
  readonly details?: unknown

  constructor(input: {
    message: string
    code?: string
    status?: number
    requestId?: string
    details?: unknown
  }) {
    super(input.message)
    this.name = 'ApiError'
    this.code = input.code ?? 'UNKNOWN'
    if (input.status !== undefined) this.status = input.status
    if (input.requestId !== undefined) this.requestId = input.requestId
    if (input.details !== undefined) this.details = input.details
  }
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (!axios.isAxiosError(error)) {
    return new ApiError({
      message: error instanceof Error ? error.message : '发生未知错误',
    })
  }

  const body = error.response?.data
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const status = error.response?.status
  const fallback =
    status === 401
      ? '登录状态已失效'
      : status === 403
        ? '没有执行该操作的权限'
        : status === 409
          ? '数据状态已经变化，请刷新后重试'
          : status === 429
            ? '请求过于频繁，请稍后重试'
            : status && status >= 500
              ? '服务暂时不可用'
              : error.message || '请求失败'

  const requestId = stringField(record.requestId)
  return new ApiError({
    message: stringField(record.detail) ?? stringField(record.message) ?? fallback,
    code: stringField(record.code) ?? (status ? 'HTTP_' + status : 'NETWORK_ERROR'),
    ...(status !== undefined ? { status } : {}),
    ...(requestId ? { requestId } : {}),
    details: body,
  })
}
