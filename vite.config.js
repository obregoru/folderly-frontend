import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Caption components live in the sibling backend repo at
// ../folderly-backend/remotion/. Server-side Remotion bundler reads
// them there at render time; allowing Vite to resolve them from the
// same path lets the browser-side Player render the SAME composition
// code so server output and live preview stay bit-identical on
// caption behavior. The resolved absolute path is imported as
// `@caption/<subpath>` from frontend source.
const captionEngineDir = path.resolve(__dirname, '../folderly-backend/remotion')

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
    // Vite 6 defaults server.fs.strict=true, which rejects imports
    // outside the project root. Extending fs.allow keeps the browser
    // dev server from 403'ing on /@fs/... requests pointing at
    // backend/remotion files.
    fs: {
      allow: [
        path.resolve(__dirname),     // frontend itself
        captionEngineDir,            // sibling backend/remotion
      ],
    },
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
