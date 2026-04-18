import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import MockApp from './ux-v2/MockApp'
import './index.css'

// Lightweight router — when the URL starts with /ux-v2 we render the
// mockup shell instead of the real app. Real app code is untouched.
const isMockup = typeof window !== 'undefined' && window.location.pathname.startsWith('/ux-v2')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      {isMockup ? <MockApp /> : <App />}
    </HelmetProvider>
  </React.StrictMode>
)
