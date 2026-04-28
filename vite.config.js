import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Capture git metadata at build time so the running app can show
// users which commit they're on. Vercel sets VERCEL_GIT_COMMIT_SHA
// in CI builds; locally we fall back to `git rev-parse --short HEAD`.
// Both fail open — never crash the build for a missing tag.
const buildHash = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return String(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 7)
  }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
})()
const buildDate = new Date().toISOString().slice(0, 16).replace('T', ' ')

// Caption components ship inside this repo at src/captionEngine/ so
// Vercel's single-repo clone can resolve `@caption/*` imports. The
// canonical source of truth lives in the sibling backend repo at
// ../folderly-backend/remotion/ — run `npm run sync-caption` to
// refresh this copy after the backend composition changes.
const captionEngineDir = path.resolve(__dirname, 'src/captionEngine')

const apiTarget = process.env.VITE_DEV_API || 'http://localhost:3002'

export default defineConfig({
  plugins: [react()],
  // Inject build metadata as compile-time constants so any component
  // can reference __BUILD_HASH__ / __BUILD_DATE__. Stringified to
  // satisfy Vite's require — without quotes the values would parse
  // as JS expressions which gives 'NaN' for hashes that look numeric.
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
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
