import { useState } from 'react'
import DraftsScreen from './screens/DraftsScreen'
import EditorScreen from './screens/EditorScreen'
import SettingsDrawer from './components/SettingsDrawer'

/**
 * UX v2 mockup root. Pure in-memory state — no backend. Used to validate
 * the new workflow (final-preview-first, icon menu below) before
 * committing to a rebuild of the real App.
 */
export default function MockApp() {
  const [activeDraftId, setActiveDraftId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-ink" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top bar */}
      <div className="sticky top-0 bg-white border-b border-[#e5e5e5] z-20 flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => { setActiveDraftId(null); setSettingsOpen(false) }}
          className="text-[12px] font-medium text-ink bg-transparent border-none cursor-pointer p-0 flex items-center gap-1"
        >
          <span className="text-[#6C5CE7] text-[14px] leading-none">●</span> Posty Posty
          <span className="text-[10px] text-muted ml-1">· ux-v2 mockup</span>
        </button>
        <div className="flex-1" />
        {activeDraftId && (
          <button
            onClick={() => setActiveDraftId(null)}
            className="text-[10px] text-[#6C5CE7] border border-[#6C5CE7] rounded py-1 px-2 bg-white cursor-pointer"
          >← Drafts</button>
        )}
        {/* Settings hamburger — always visible */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-[18px] text-ink bg-transparent border-none cursor-pointer px-1 leading-none"
          aria-label="Settings menu"
          title="Settings"
        >☰</button>
      </div>

      <div className="max-w-[520px] mx-auto">
        {!activeDraftId && <DraftsScreen onOpen={setActiveDraftId} />}
        {activeDraftId && <EditorScreen draftId={activeDraftId} onBack={() => setActiveDraftId(null)} />}
      </div>

      <div className="text-center text-[9px] text-muted py-4">
        UX v2 mockup — no backend, no saves. Close and reopen to reset.
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
