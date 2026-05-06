// V3 Content Studio — top-level shell.
//
// Mounted by main.jsx when window.location.pathname starts with
// /content-studio. Lives entirely apart from AppV2 — no shared
// components, no shared state. The only shared infrastructure is
// the auth + tenant helpers from src/api.js (re-exported via
// src/v3/api.js).
//
// Phase 0 surface:
//   - Auth gate (redirects to /login if no session)
//   - Top nav with tenant label + back-to-V2 link
//   - Two screens: Dashboard (placeholder) and Config (working form)
//
// Phase 1+ adds: Topic Ideation, Draft Editor, Schedule view.

import { useEffect, useState } from 'react'
import * as api from './api'
import ContentStudioDashboard from './screens/ContentStudioDashboard'
import ContentConfig from './screens/ContentConfig'
import TopicIdeation from './screens/TopicIdeation'
import Drafts from './screens/Drafts'

export default function ContentStudioApp() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [screen, setScreen] = useState('dashboard') // 'dashboard' | 'ideation' | 'drafts' | 'config'

  // Mirror AppV2's auth bootstrap so V3 plays by the same rules.
  // Without setting api.tenantSlug from /me, every V3 endpoint call
  // throws "Tenant not loaded" — Vercel preview domains have empty
  // localStorage even when the cookie is valid.
  useEffect(() => {
    api.getMe().then(u => {
      if (u && u.id) {
        setUser(u)
        if (u.csrf_token) api.setCsrfToken(u.csrf_token)
        if (u.tenant_slug && !api.tenantSlug()) api.setTenantSlug(u.tenant_slug)
      }
      setAuthChecked(true)
    }).catch(() => setAuthChecked(true))
  }, [])

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[12px] text-muted">
        Loading…
      </div>
    )
  }
  if (!user) {
    // Same redirect-to-login pattern AppV2 uses on auth failure.
    if (typeof window !== 'undefined') {
      window.location.href = '/login?redirect=' + encodeURIComponent('/content-studio')
    }
    return null
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white border-b border-[#e5e5e5] px-4 py-2 flex items-center gap-3">
        <span className="text-[14px] font-bold">📝 Content Studio</span>
        <span className="text-[10px] text-muted">v3 · {api.tenantSlug() || 'no-tenant'}</span>
        <div className="flex-1" />
        <nav className="flex items-center gap-1">
          <NavButton active={screen === 'dashboard'} onClick={() => setScreen('dashboard')}>
            Dashboard
          </NavButton>
          <NavButton active={screen === 'ideation'} onClick={() => setScreen('ideation')}>
            Ideation
          </NavButton>
          <NavButton active={screen === 'drafts'} onClick={() => setScreen('drafts')}>
            Drafts
          </NavButton>
          <NavButton active={screen === 'config'} onClick={() => setScreen('config')}>
            Config
          </NavButton>
        </nav>
        <a
          href="/"
          className="text-[10px] text-[#6C5CE7] border border-[#6C5CE7] rounded py-1 px-2 bg-white cursor-pointer flex-shrink-0 no-underline whitespace-nowrap ml-2"
          title="Back to the V2 social-media drafts (video editor + scheduling)"
        >🎬 Social posts</a>
      </header>
      <main className="max-w-[1100px] mx-auto p-4">
        {screen === 'dashboard' && <ContentStudioDashboard />}
        {screen === 'ideation' && <TopicIdeation />}
        {screen === 'drafts' && <Drafts />}
        {screen === 'config' && <ContentConfig />}
      </main>
    </div>
  )
}

function NavButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] py-1 px-3 rounded border cursor-pointer ${
        active
          ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
          : 'bg-white text-ink border-[#e5e5e5] hover:border-[#6C5CE7]'
      }`}
    >{children}</button>
  )
}
