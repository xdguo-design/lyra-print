import { z } from 'zod'

const schema = z.object({
  VITE_API_BASE_URL: z.string().min(1).default('/api'),
  VITE_APP_ENV: z.enum(['development', 'test', 'production']).optional(),
})

const parsed = schema.safeParse(import.meta.env)
if (!parsed.success) throw new Error('Invalid frontend environment: ' + parsed.error.message)

export const env = {
  apiBaseUrl: parsed.data.VITE_API_BASE_URL,
  appEnv: parsed.data.VITE_APP_ENV ?? import.meta.env.MODE,
} as const
