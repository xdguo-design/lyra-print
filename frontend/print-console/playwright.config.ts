import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'tests',
  timeout:60000,
  use:{
    // 使用本机已安装的 Google Chrome，免去 playwright install 下载
    channel:'chrome',
    headless:true
  }
})
