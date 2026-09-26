import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.POC_PORT ?? '5175'
const backendHttp = `http://localhost:${backendPort}`
const backendWs = `ws://localhost:${backendPort}`

// Dashboard React servita da Vite in dev (porta 5174) con proxy /api e /ws
// verso il backend Node (porta 5175).
export default defineConfig({
  root: 'dashboard',
  plugins: [react()],
  build: {
    outDir: '../dist/dashboard',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: backendHttp, changeOrigin: true },
      '/ws': { target: backendWs, ws: true },
    },
  },
})
