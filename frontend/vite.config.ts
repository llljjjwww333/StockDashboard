import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    allowedHosts: loadEnv(mode, process.cwd(), 'VITE_PREVIEW_HOST').VITE_PREVIEW_HOST
      ? [loadEnv(mode, process.cwd(), 'VITE_PREVIEW_HOST').VITE_PREVIEW_HOST]
      : [],
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000', ws: true },
      '/health': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000' },
    },
  },
}))
