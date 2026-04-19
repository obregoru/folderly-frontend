import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import MockApp from './ux-v2/MockApp'
import AppV2 from './v2/AppV2'
import './index.css'

// Routing:
//   default       → real app (proven legacy experience — what prod users get)
//   ?v2=1         → real v2 rebuild (opt-in, promote to default once stable)
//   ?real=1       → real app (explicit; same as default — kept for backlinks)
//   ?mockup=1     → clickable ux-v2 mockup (design reference, no data)
//   /ux-v2        → same mockup, path-based
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const wantsV2   = params?.get('v2') === '1'
const wantsMockupByPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/ux-v2')
const wantsMockupByQuery = params?.get('mockup') === '1'

let Mount
if (wantsV2) Mount = AppV2
else if (wantsMockupByPath || wantsMockupByQuery) Mount = MockApp
else Mount = App // real app is the default and the ?real=1 fallthrough

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <Mount />
    </HelmetProvider>
  </React.StrictMode>
)
