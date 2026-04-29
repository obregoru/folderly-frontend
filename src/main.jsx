import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import MockApp from './ux-v2/MockApp'
import AppV2 from './v2/AppV2'
import ProducerPopout from './v2/components/ProducerPopout'
import './index.css'

// Routing:
//   default                       → v2 rebuild (the shipped product)
//   ?real=1                       → legacy App (fallback while v2 settles)
//   ?mockup=1                     → clickable ux-v2 mockup (design ref, no data)
//   /ux-v2                        → same mockup, path-based
//   ?producerPopout=<draftId>     → standalone producer chat window for that draft
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const wantsReal = params?.get('real') === '1'
const wantsMockupByPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/ux-v2')
const wantsMockupByQuery = params?.get('mockup') === '1'
const popoutDraftId = params?.get('producerPopout')

let Mount
let mountProps = {}
if (popoutDraftId) {
  Mount = ProducerPopout
  mountProps = { draftId: popoutDraftId }
} else if (wantsReal) Mount = App
else if (wantsMockupByPath || wantsMockupByQuery) Mount = MockApp
else Mount = AppV2 // v2 is the default prod experience

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <Mount {...mountProps} />
    </HelmetProvider>
  </React.StrictMode>
)
