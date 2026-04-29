// Standalone popup window that mounts the producer chat for one
// draft. Triggered by `?producerPopout=<draftId>` in main.jsx.
//
// In popup mode there's no AppV2 / no useJobSync — we synthesize a
// minimal shim that calls api.updateJob directly so Apply still
// writes overlay/voiceover changes to the DB. The editor window
// won't reflect those writes live (no shared React state across
// windows), but the next reload of the editor will pick them up.

import { useEffect, useState } from 'react'
import * as api from '../../api'
import ProducerChatPanel from './ProducerChatPanel'

export default function ProducerPopout({ draftId }) {
  const [job, setJob] = useState(null)

  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(j => setJob(j || null)).catch(() => {})
    document.title = `🎬 Producer Chat — ${draftId.slice(0, 8)}`
  }, [draftId])

  // Minimal jobSync shim that ProducerChatPanel's apply flow needs.
  // No debounce; popup writes are infrequent so the immediate PATCH
  // is fine and arguably better (no risk of an unflushed save when
  // the user closes the window).
  const jobSync = {
    saveOverlaySettings: (overlaySettings) =>
      api.updateJob(draftId, { overlay_settings: overlaySettings }).catch(e => {
        console.error('[popout] saveOverlaySettings failed', e?.message)
      }),
    saveVoiceoverSettings: (voiceoverSettings) =>
      api.updateJob(draftId, { voiceover_settings: voiceoverSettings }).catch(e => {
        console.error('[popout] saveVoiceoverSettings failed', e?.message)
      }),
  }

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="border-b border-[#e5e5e5] px-3 py-2 flex items-center gap-2 sticky top-0 bg-white z-10">
        <span className="text-[14px]">🎬</span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium leading-tight">Producer Chat</div>
          <div className="text-[10px] text-muted truncate">
            {job?.title || (draftId ? `Draft ${draftId.slice(0, 8)}` : '…')}
          </div>
        </div>
        <button
          onClick={() => window.close()}
          className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
        >Close</button>
      </header>
      <div className="p-3 max-w-[640px] mx-auto">
        {draftId ? (
          <ProducerChatPanel draftId={draftId} jobSync={jobSync} />
        ) : (
          <div className="text-[11px] text-[#c0392b]">Missing draft id.</div>
        )}
        <div className="mt-3 text-[9px] text-muted italic">
          Note: changes you Apply here save to the draft, but you'll need to refresh the editor tab to see them reflected there.
        </div>
      </div>
    </div>
  )
}
