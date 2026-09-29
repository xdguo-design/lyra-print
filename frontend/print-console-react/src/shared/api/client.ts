import axios from 'axios'
import { env } from '@/app/config/env'
import { toApiError } from '@/shared/api/error'

const API_KEY_STORAGE = 'print-platform-api-key'

export const apiClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem(API_KEY_STORAGE)?.trim()
  if (apiKey) config.headers.Authorization = 'Bearer ' + apiKey
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(toApiError(error)),
)

export function setPlatformApiKey(value: string) {
  localStorage.setItem(API_KEY_STORAGE, value.trim())
}

export function clearPlatformApiKey() {
  localStorage.removeItem(API_KEY_STORAGE)
}
