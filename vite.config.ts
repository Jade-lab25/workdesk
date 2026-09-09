import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 导航页部署在 gswdb.cn 根路径，base 保持 '/'
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
