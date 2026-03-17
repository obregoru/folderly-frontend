import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'https://postyposty-production.up.railway.app',
        changeOrigin: true,
        secure: true,
      },
      '/uploads': {
        target: 'https://postyposty-production.up.railway.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
