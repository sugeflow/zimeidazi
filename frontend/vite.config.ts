import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',  // 相对路径，适配 proxy
  // 仅开发时：把接口转发到本机正在运行的后端（桌面版或 easel web，端口 7860）
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:7860', changeOrigin: true },
      '/static': { target: 'http://127.0.0.1:7860', changeOrigin: true },
    },
  },
})
