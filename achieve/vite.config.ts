import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 轻量路径：Achievement 部署在 gswdb.cn/achieve 子路径，base 必须为 /achieve/
export default defineConfig({
  plugins: [react()],
  base: '/achieve/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})