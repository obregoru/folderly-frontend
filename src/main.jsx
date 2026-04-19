import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import MockApp from './ux-v2/MockApp'
import './index.css'

// On the ux-v2 branch the mockup is the default — simplifies testing
// on branch previews where the default URL opens straight into the
// new flow. The real app is still reachable at `?real=1` for
// side-by-side comparisons.
// On main, the real app is the default and the mockup is at /ux-v2
// (path-based) for anyone who wants to preview the new flow.
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const wantsMockupByPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/ux-v2')
const wantsRealByQuery = params?.get('real') === '1'
const wantsMockupByQuery = params?.get('mockup') === '1'

// __UX_V2_DEFAULT__ is replaced at build time by Vite's define config,
// set to "true" on the ux-v2 branch so the mockup is shown by default.
const defaultToMockup = true

const isMockup = wantsRealByQuery ? false : (wantsMockupByPath || wantsMockupByQuery || defaultToMockup)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      {isMockup ? <MockApp /> : <App />}
    </HelmetProvider>
  </React.StrictMode>
)
