import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Caption components ship inside this repo at src/captionEngine/ so
// Vercel's single-repo clone can resolve `@caption/*` imports. The
// canonical source of truth lives in the sibling backend repo at
// ../folderly-backend/remotion/ — run `npm run sync-caption` to
// refresh this copy after the backend composition changes.
const captionEngineDir = path.resolve(__dirname, 'src/captionEngine')

const apiTarget = process.env.VITE_DEV_API || 'http://localhost:3002'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@caption': captionEngineDir,
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: apiTarget.startsWith('https'),
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
        secure: apiTarget.startsWith('https'),
      },
    },
  },
})
