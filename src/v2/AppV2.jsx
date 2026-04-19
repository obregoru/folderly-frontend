import { useEffect, useState } from 'react'
import * as api from '../api'
import useJobSync from '../hooks/useJobSync'
import DraftsV2 from './screens/DraftsV2'
import ScheduleV2 from './screens/ScheduleV2'
import HistoryV2 from './screens/HistoryV2'
import EditorV2 from './screens/EditorV2'
import SettingsDrawerV2 from './components/SettingsDrawerV2'

/**
 * Real v2 app — mockup layout + real backend. Phase 1: shell only.
 *   - Drafts list from real API
 *   - Bottom nav between Drafts / Schedule / History
 *   - Settings drawer wraps existing Sidebar content
 *   - Editor is a stub that mounts the existing App's content (phase 2
 *     replaces with MediaPanel / HintsPanel / VoiceoverPanel / etc.)
 */
export default function AppV2() {
  // Real app state: files, user hint, settings
  const [files, setFiles] = useState([])
  const [userHint, setUserHint] = useState(() => sessionStorage.getItem('posty_hint') || '')
  const [settings, setSettings] = useState({})
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)


  // Mockup-style nav state
  const [mode, setMode] = useState('drafts')
  const [activeDraftId, setActiveDraftId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Check auth + load tenant settings on mount (mirrors App.jsx).
  // On Vercel preview domains localStorage is empty even when the session
  // cookie is valid, so we must get the tenant slug from /me and set it
  // explicitly before any api call uses it.
  useEffect(() => {
    api.getMe().then(u => {
      if (u && u.id) {
        setUser(u)
        if (u.csrf_token) api.setCsrfToken(u.csrf_token)
        if (u.tenant_slug && !api.tenantSlug()) {
          api.setTenantSlug(u.tenant_slug)
        }
        api.getSettings().then(s => setSettings(s || {})).catch(() => {})
      }
      setAuthChecked(true)
    }).catch(() => setAuthChecked(true))
  }, [])

  // Job persistence wiring — same hook the real app uses.
  const jobSync = useJobSync({ files, setFiles, userHint, setUserHint, settings })

  // File-list operations (defined after jobSync so they can reference it).
  const addFiles = (fileList) => {
    const picked = Array.from(fileList || [])
    if (picked.length === 0) return
    const entries = picked.map(f => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      isImg: f.type?.startsWith('image/'),
      parsed: { occasions: [], products: [], moments: [] },
      status: null,
      captions: null,
      _previewUrl: URL.createObjectURL(f),
    }))
    setFiles(prev => [...prev, ...entries])
    // TODO Phase 2+: eager upload + saveFileToJob to persist drafts
    // before merge. For now the existing VideoMerge handles upload on
    // the merge click.
  }
  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    jobSync.deleteFileFromJob?.(id)
  }
  const reorderFiles = (fromIdx, toIdx) => {
    setFiles(prev => {
      if (fromIdx < 0 || fromIdx >= prev.length || toIdx < 0 || toIdx >= prev.length || fromIdx === toIdx) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      jobSync.saveFileOrder?.(next)
      return next
    })
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-[12px]">
        Loading…
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-[14px] font-medium">Not signed in</div>
        <div className="text-[11px] text-muted">This is the v2 preview. Sign in on the main app first, then come back.</div>
        <a href="/?real=1" className="text-[11px] py-2 px-4 bg-[#6C5CE7] text-white rounded no-underline">Go to main app</a>
      </div>
    )
  }

  const inEditor = mode === 'drafts' && activeDraftId

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-ink pb-16" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top bar */}
      <div className="sticky top-0 bg-white border-b border-[#e5e5e5] z-20 flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => { setMode('drafts'); setActiveDraftId(null); setSettingsOpen(false) }}
          className="text-[12px] font-medium text-ink bg-transparent border-none cursor-pointer p-0 flex items-center gap-1"
        >
          <span className="text-[#6C5CE7] text-[14px] leading-none">●</span>
          {settings?.name || 'Posty Posty'}
          <span className="text-[9px] text-muted ml-1">· v2</span>
        </button>
        <div className="flex-1" />
        {inEditor && (
          <button
            onClick={() => setActiveDraftId(null)}
            className="text-[10px] text-[#6C5CE7] border border-[#6C5CE7] rounded py-1 px-2 bg-white cursor-pointer"
          >← Drafts</button>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-[18px] text-ink bg-transparent border-none cursor-pointer px-1 leading-none"
          aria-label="Settings menu"
        >☰</button>
      </div>

      <div className="max-w-[520px] mx-auto">
        {inEditor && (
          <EditorV2
            draftId={activeDraftId}
            jobSync={jobSync}
            files={files}
            setFiles={setFiles}
            settings={settings}
            addFiles={addFiles}
            removeFile={removeFile}
            reorderFiles={reorderFiles}
          />
        )}
        {mode === 'drafts' && !activeDraftId && (
          <DraftsV2
            jobSync={jobSync}
            onOpen={async (id) => {
              await jobSync.loadJob(id)
              setActiveDraftId(id)
            }}
            onNew={async () => {
              const id = await jobSync.ensureJob()
              if (id) setActiveDraftId(id)
            }}
          />
        )}
        {mode === 'schedule' && <ScheduleV2 />}
        {mode === 'history' && <HistoryV2 />}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e5e5e5] z-20">
        <div className="max-w-[520px] mx-auto flex items-stretch">
          {[
            { key: 'drafts',   icon: '📝', label: 'Drafts' },
            { key: 'schedule', icon: '📅', label: 'Schedule' },
            { key: 'history',  icon: '📜', label: 'History' },
          ].map(t => {
            const isActive = mode === t.key && !(t.key === 'drafts' && activeDraftId)
            return (
              <button
                key={t.key}
                onClick={() => { setMode(t.key); if (t.key !== 'drafts') setActiveDraftId(null) }}
                className={`flex-1 flex flex-col items-center py-2 border-none cursor-pointer ${isActive ? 'text-[#6C5CE7]' : 'text-muted'} bg-transparent`}
              >
                <span className="text-[18px] leading-none">{t.icon}</span>
                <span className="text-[10px] mt-0.5 font-medium">{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <SettingsDrawerV2
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
      />
    </div>
  )
}
