import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const antdGroups:Record<string,string>={
  input:'antd-entry',select:'antd-entry',form:'antd-entry',radio:'antd-entry',checkbox:'antd-entry',switch:'antd-entry',slider:'antd-entry','input-number':'antd-entry',
  table:'antd-display',card:'antd-display',descriptions:'antd-display',tag:'antd-display',badge:'antd-display',timeline:'antd-display',empty:'antd-display',
  menu:'antd-navigation',tabs:'antd-navigation',pagination:'antd-navigation',steps:'antd-navigation',dropdown:'antd-navigation',
  alert:'antd-feedback',modal:'antd-feedback',drawer:'antd-feedback',spin:'antd-feedback',tooltip:'antd-feedback',result:'antd-feedback',
  layout:'antd-layout',space:'antd-layout',divider:'antd-layout',button:'antd-layout',collapse:'antd-layout'
}

export default defineConfig({
  plugins:[vue()],
  server:{port:5173,proxy:{'/api':'http://localhost:8080','/actuator':'http://localhost:8080'}},
  build:{
    rollupOptions:{
      output:{
        manualChunks(id){
          if(id.includes('/node_modules/vue/'))return 'vue-runtime'
          if(id.includes('/node_modules/axios/'))return 'axios'
          if(id.includes('/node_modules/@ant-design/icons-vue/'))return 'antd-icons'
          const match=id.match(/\/node_modules\/ant-design-vue\/es\/([^/]+)/)
          if(match)return antdGroups[match[1]]||'antd-core'
          if(id.includes('/node_modules/qrcode/'))return 'qrcode'
          if(id.includes('/node_modules/jsbarcode/'))return 'jsbarcode'
          return undefined
        }
      }
    }
  }
})
