import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import MockApp from './ux-v2/MockApp'
import AppV2 from './v2/AppV2'
import './index.css'
// LivePreviewTestPage lazy-loaded so the Remotion/Player runtime
// only ships to users who open ?preview-test=1 (dev-only route).
// Keeps the main bundle unchanged for normal users.
const LivePreviewTestPage = lazy(() => import('./v2/LivePreviewTestPage'))

// Routing:
//   default       → v2 rebuild (the shipped product)
//   ?real=1       → legacy App (fallback while v2 settles; remove once stable)
//   ?mockup=1     → clickable ux-v2 mockup (design reference, no data)
//   /ux-v2        → same mockup, path-based
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const wantsReal = params?.get('real') === '1'
const wantsMockupByPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/ux-v2')
const wantsMockupByQuery = params?.get('mockup') === '1'
// Step-2 verification route: ?preview-test=1 mounts the standalone
// LivePreviewPlayer test harness so we can probe a real tenant's
// merged video + segment audio URLs through the browser-side Player
// without having to wire it into the editor UI first. Dev/manual use
// only — AppV2 still owns the default route.
const wantsPreviewTest = params?.get('preview-test') === '1'

let Mount
if (wantsPreviewTest) Mount = LivePreviewTestPage
else if (wantsReal) Mount = App
else if (wantsMockupByPath || wantsMockupByQuery) Mount = MockApp
else Mount = AppV2 // v2 is the default prod experience

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <Suspense fallback={<div style={{ padding: 24, fontFamily: 'system-ui' }}>Loading…</div>}>
        <Mount />
      </Suspense>
    </HelmetProvider>
  </React.StrictMode>
)
