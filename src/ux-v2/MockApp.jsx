import { useState } from 'react'
import DraftsScreen from './screens/DraftsScreen'
import EditorScreen from './screens/EditorScreen'
import ScheduleScreen from './screens/ScheduleScreen'
import HistoryScreen from './screens/HistoryScreen'
import SettingsDrawer from './components/SettingsDrawer'

/**
 * UX v2 mockup root. Pure in-memory state — no backend.
 *
 * Three top-level modes selected via bottom nav:
 *   Drafts   → list of drafts, tap one to open the editor
 *   Schedule → calendar view across all drafts/channels
 *   History  → past posts with filters, analytics, retry
 *
 * Settings are behind a ☰ in the top bar (tenant + account scopes).
 */
export default function MockApp() {
  const [mode, setMode] = useState('drafts') // 'drafts' | 'schedule' | 'history'
  const [activeDraftId, setActiveDraftId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // When the user opens a draft from Drafts mode, the editor takes over
  // the viewport — bottom nav stays visible so they can bail out.
  const inEditor = mode === 'drafts' && activeDraftId

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-ink pb-16" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top bar */}
      <div className="sticky top-0 bg-white border-b border-[#e5e5e5] z-20 flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => { setMode('drafts'); setActiveDraftId(null); setSettingsOpen(false) }}
          className="text-[12px] font-medium text-ink bg-transparent border-none cursor-pointer p-0 flex items-center gap-1"
        >
          <span className="text-[#6C5CE7] text-[14px] leading-none">●</span> Posty Posty
          <span className="text-[10px] text-muted ml-1">· ux-v2 mockup</span>
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
          title="Settings"
        >☰</button>
      </div>

      <div className="max-w-[520px] mx-auto">
        {inEditor && <EditorScreen draftId={activeDraftId} />}
        {mode === 'drafts' && !activeDraftId && <DraftsScreen onOpen={setActiveDraftId} />}
        {mode === 'schedule' && <ScheduleScreen />}
        {mode === 'history' && <HistoryScreen />}
      </div>

      {/* Bottom nav — persistent. Tap-to-switch between Drafts / Schedule /
          History. Hidden inside the editor? No — keep it so user can bail
          out to schedule/history without going through drafts. */}
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

      <div className="text-center text-[9px] text-muted py-4">
        UX v2 mockup — no backend, no saves. Close and reopen to reset.
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
