import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath,URL } from 'node:url'

export default defineConfig({
  plugins:[vue()],
  resolve:{
    alias:{
      '@print-platform/sdk-core':fileURLToPath(new URL('../../sdk/print-sdk-core/src/index.ts',import.meta.url)),
      '@print-platform/preview-browser':fileURLToPath(new URL('../../sdk/print-preview-browser/src/index.ts',import.meta.url))
    }
  },
  server:{port:3000,strictPort:true}
})
