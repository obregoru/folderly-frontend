import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import MockApp from './ux-v2/MockApp'
import AppV2 from './v2/AppV2'
import './index.css'

// Routing:
//   ?real=1       → real app (legacy, Phase 0)
//   ?v2=1         → real v2 app in progress (the rebuild)
//   /ux-v2        → clickable mockup (ux-v2 branch default on root too)
//   default       → on ux-v2 branch = mockup; on main = real App
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const wantsReal = params?.get('real') === '1'
const wantsV2   = params?.get('v2') === '1'
const wantsMockupByPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/ux-v2')
const wantsMockupByQuery = params?.get('mockup') === '1'

// On the ux-v2 branch the mockup is the default so testers don't need to
// remember a path. Flip this back to false when merging to main.
const defaultToMockup = true

let Mount
if (wantsReal) Mount = App
else if (wantsV2) Mount = AppV2
else if (wantsMockupByPath || wantsMockupByQuery) Mount = MockApp
else if (defaultToMockup) Mount = MockApp
else Mount = App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <Mount />
    </HelmetProvider>
  </React.StrictMode>
)
