import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 允许通过环境变量自定义后端代理目标和前端监听端口，
// 便于本地脚本（scripts/run-web.bat）灵活更换端口。
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080'
const devPort = Number(process.env.WEB_PORT) || 3000

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: devPort,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true, // 支持WebSocket代理
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
