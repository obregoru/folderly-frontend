import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import useJobSync from '../hooks/useJobSync'
import DraftsV2 from './screens/DraftsV2'
import ScheduleV2 from './screens/ScheduleV2'
import HistoryV2 from './screens/HistoryV2'
import EditorV2 from './screens/EditorV2'
import SettingsDrawerV2 from './components/SettingsDrawerV2'
import JobAiLogModal from './components/JobAiLogModal'

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
  const [aiLogOpen, setAiLogOpen] = useState(false)
  // Draft-name editing state — declared up here so the hooks always run
  // in the same order regardless of auth-checked / user branches below.
  // Moving them after the early returns triggers React error #310
  // (rendered more hooks than during the previous render).
  const [nameDraft, setNameDraft] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [autoNaming, setAutoNaming] = useState(false)

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

  // Keep the header's draft-name input in sync with the backing job list.
  // Placed here (after jobSync, before the auth-gated early returns) so
  // hook order stays stable across renders regardless of auth state.
  useEffect(() => {
    if (!activeDraftId) { setNameDraft(''); return }
    const j = (jobSync?.jobList || []).find(x => x.uuid === activeDraftId)
    if (j) setNameDraft(j.job_name || '')
  }, [activeDraftId, jobSync?.jobList])

  // Persist per-clip trim / speed / thumbs / photo-motion when the inner
  // controls (VideoTrimmer, speed picker, photo duration/motion pickers)
  // fire their window events. Same mechanism App.jsx uses. Without this
  // listener in v2, trims just mutated in-memory and were lost on reload.
  //
  // Uses a ref-based files lookup so the listener always sees the latest
  // array, and attaches ONCE on mount so iOS Safari doesn't drop events
  // during a re-register frame.
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])
  const jobSyncRef = useRef(jobSync)
  useEffect(() => { jobSyncRef.current = jobSync }, [jobSync])
  useEffect(() => {
    const findItem = (id) => (filesRef.current || []).find(f => f.id === id)
    const onTrimChange = (e) => {
      const item = findItem(e.detail?.itemId)
      if (!item) { console.warn('[AppV2] posty-trim-change: no file for', e.detail?.itemId); return }
      console.log(`[AppV2] saving trim: id=${item.id} start=${item._trimStart} end=${item._trimEnd}`)
      jobSyncRef.current?.saveFileTrim?.(item)
    }
    const onTrimThumbs = (e) => {
      const item = findItem(e.detail?.itemId)
      if (item && e.detail?.thumbs) jobSyncRef.current?.saveFileTrimThumbs?.(item, e.detail.thumbs)
    }
    const onSpeedChange = (e) => {
      const item = findItem(e.detail?.itemId)
      if (!item) return
      const isImg = item.isImg || item.file?.type?.startsWith('image/') || item._mediaType?.startsWith('image/')
      if (isImg) {
        console.log(`[AppV2] saving photo motion: id=${item.id} motion=${item._photoMotion} dur=${item._trimEnd}`)
        jobSyncRef.current?.saveFilePhotoMotion?.(item)
      } else {
        console.log(`[AppV2] saving speed: id=${item.id} speed=${item._speed}`)
        jobSyncRef.current?.saveFileSpeed?.(item)
      }
    }
    window.addEventListener('posty-trim-change', onTrimChange)
    window.addEventListener('posty-trim-thumbs', onTrimThumbs)
    window.addEventListener('posty-speed-change', onSpeedChange)
    return () => {
      window.removeEventListener('posty-trim-change', onTrimChange)
      window.removeEventListener('posty-trim-thumbs', onTrimThumbs)
      window.removeEventListener('posty-speed-change', onSpeedChange)
    }
  }, [])

  // File-list operations (defined after jobSync so they can reference it).
  const addFiles = async (fileList) => {
    const picked = Array.from(fileList || [])
    if (picked.length === 0) return
    const entries = picked.map(f => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      isImg: f.type?.startsWith('image/'),
      parsed: { occasions: [], products: [], moments: [] },
      status: 'loading',
      captions: null,
      _previewUrl: URL.createObjectURL(f),
    }))
    setFiles(prev => [...prev, ...entries])

    // Eager upload — persist each file to the server immediately so draft
    // survives tab close / refresh / crash. Uploads happen serially to
    // avoid iOS memory pressure with large clips; parallelism can come
    // later. Each upload creates/updates the job on the server, so the
    // draft shows up in the list the moment anything is in flight.
    const activeJobId = await jobSync.ensureJob()
    if (!activeJobId) {
      console.warn('[addFiles] ensureJob returned null — files will stay local-only')
      // Mark them as errored so the user sees something's wrong
      setFiles(prev => prev.map(f => entries.find(e => e.id === f.id) ? { ...f, status: 'error' } : f))
      return
    }

    for (const item of entries) {
      try {
        const uploadResult = await api.uploadFile(item.file, '', null, item.parsed, null, activeJobId)
        item.uploadResult = uploadResult
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, uploadResult, status: 'done' } : f))
        await jobSync.saveFileToJob({ ...item, uploadResult })
      } catch (e) {
        console.error('[addFiles] upload failed:', e.message)
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error' } : f))
      }
    }

    // Refresh the jobs list so DraftsV2 + the editor header show the
    // updated file_count / status for the active draft.
    if (jobSync.refreshJobList) {
      try { await jobSync.refreshJobList() } catch {}
    }
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

  // Active draft's current name — reads from jobSync.jobList so editor
  // header reflects renames made anywhere (Drafts list, Editor header,
  // auto-name). The state for this is hoisted to the top of the
  // component with the other hooks so hook order stays stable across
  // auth-checked / user / no-user branches.
  const activeJob = inEditor ? (jobSync.jobList || []).find(j => j.uuid === activeDraftId) : null

  const saveDraftName = async () => {
    if (!activeDraftId) return
    const next = (nameDraft || '').trim()
    const current = activeJob?.job_name || ''
    if (next === current) return
    setNameSaving(true)
    try {
      await api.updateJob(activeDraftId, { job_name: next || null })
      if (jobSync.refreshJobList) await jobSync.refreshJobList()
    } catch (e) {
      alert('Rename failed: ' + (e.message || e))
      setNameDraft(current)
    } finally {
      setNameSaving(false)
    }
  }

  const runAutoName = async () => {
    if (!activeDraftId || autoNaming) return
    setAutoNaming(true)
    try {
      const r = await api.autoNameJob(activeDraftId)
      if (r?.error) throw new Error(r.error)
      if (r?.job_name) setNameDraft(r.job_name)
      if (jobSync.refreshJobList) await jobSync.refreshJobList()
    } catch (e) {
      alert('Auto-name failed: ' + (e.message || e))
    } finally {
      setAutoNaming(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-ink pb-16" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top bar */}
      <div className="sticky top-0 bg-white border-b border-[#e5e5e5] z-20 flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => { setMode('drafts'); setActiveDraftId(null); setSettingsOpen(false) }}
          className="text-[12px] font-medium text-ink bg-transparent border-none cursor-pointer p-0 flex items-center gap-1 flex-shrink-0"
          title={inEditor ? 'Back to drafts' : settings?.name || 'Drafts'}
        >
          <span className="text-[#6C5CE7] text-[14px] leading-none">●</span>
          {!inEditor && <>{settings?.name || 'Posty Posty'}<span className="text-[9px] text-muted ml-1">· v2</span></>}
        </button>
        {inEditor && (
          <input
            type="text"
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={saveDraftName}
            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } else if (e.key === 'Escape') { setNameDraft(activeJob?.job_name || ''); e.currentTarget.blur() } }}
            placeholder="Name this draft…"
            className="text-[12px] font-medium text-ink bg-[#f5f4f0] border border-[#e5e5e5] rounded outline-none flex-1 min-w-[120px] py-1 px-2 focus:border-[#6C5CE7] focus:bg-white placeholder:text-muted placeholder:font-normal placeholder:italic"
            aria-label="Draft name"
          />
        )}
        {!inEditor && <div className="flex-1" />}
        {inEditor && (
          <>
            <SaveStatus
              jobSync={jobSync}
              files={files}
              nameSaving={nameSaving}
              draftId={activeDraftId}
            />
            <button
              onClick={() => setActiveDraftId(null)}
              className="text-[10px] text-[#6C5CE7] border border-[#6C5CE7] rounded py-1 px-2 bg-white cursor-pointer flex-shrink-0"
            >← Drafts</button>
            <button
              onClick={() => setAiLogOpen(true)}
              className="text-[10px] text-[#6C5CE7] border border-[#6C5CE7] rounded py-1 px-2 bg-white cursor-pointer flex-shrink-0"
              title="Every AI prompt + response for this draft — copy out and paste into ChatGPT or Gemini for a second opinion"
              aria-label="AI activity log"
            >🤖 AI log</button>
          </>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-[18px] text-ink bg-transparent border-none cursor-pointer px-1 leading-none"
          aria-label="Settings menu"
        >☰</button>
      </div>

      {/* Job ID sub-bar — short ID on the left, Auto-name on the right
          when the draft hasn't been named yet. */}
      {inEditor && activeDraftId && (
        <div className="sticky top-[44px] bg-white border-b border-[#e5e5e5] z-20 flex items-center gap-2 px-3 py-1">
          <button
            onClick={async () => {
              try { await navigator.clipboard.writeText(activeDraftId) } catch {}
            }}
            className="text-[10px] font-mono text-muted bg-transparent border-none cursor-pointer p-0 hover:text-[#6C5CE7]"
            title={`Job #${activeDraftId} — click to copy full UUID`}
          >
            <span className="text-muted mr-1">Job</span>
            #{(activeDraftId.split('-').pop() || activeDraftId).slice(-8)}
          </button>
          <div className="flex-1" />
          {!nameDraft && (
            <button
              onClick={runAutoName}
              disabled={autoNaming}
              className="text-[9px] text-[#6C5CE7] border border-[#6C5CE7] rounded py-0.5 px-1.5 bg-white cursor-pointer disabled:opacity-50"
              title="Generate a name from this draft's visuals + hints"
            >{autoNaming ? '✨…' : '✨ Auto-name'}</button>
          )}
        </div>
      )}

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
            user={user}
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
      <JobAiLogModal
        open={aiLogOpen}
        draftId={activeDraftId}
        onClose={() => setAiLogOpen(false)}
      />
    </div>
  )
}

// Save status pill in the editor header. Shows "Uploading N…" while
// files are in-flight, "Saving…" when the job itself is flushing, or
// "✓ Saved". Click to force-flush pending saves + refresh the list so
// the user never feels like something's in limbo.
function SaveStatus({ jobSync, files, nameSaving, draftId }) {
  const uploading = (files || []).filter(f => f.status === 'loading').length
  const erroredUploads = (files || []).filter(f => f.status === 'error').length
  const busy = uploading > 0 || !!jobSync?.savingJob || !!nameSaving
  const [flushing, setFlushing] = useState(false)

  const save = async () => {
    if (!draftId || flushing) return
    setFlushing(true)
    try {
      await jobSync?.flushPendingSave?.()
      await jobSync?.refreshJobList?.()
    } catch (e) {
      console.warn('[SaveStatus] flush failed:', e.message)
    } finally {
      setFlushing(false)
    }
  }

  let label = '✓ Saved'
  let cls = 'text-[#2D9A5E] border-[#2D9A5E]/50 bg-white'
  if (uploading > 0) { label = `Uploading ${uploading}…`; cls = 'text-[#d97706] border-[#d97706]/50 bg-[#fef3c7]' }
  else if (busy || flushing) { label = 'Saving…'; cls = 'text-[#6C5CE7] border-[#6C5CE7]/50 bg-white' }
  else if (erroredUploads > 0) { label = `${erroredUploads} failed`; cls = 'text-[#c0392b] border-[#c0392b]/50 bg-white' }

  return (
    <button
      onClick={save}
      disabled={flushing}
      className={`text-[9px] border rounded py-0.5 px-2 cursor-pointer disabled:opacity-60 ${cls}`}
      title={`${label} — click to force-save + refresh`}
    >{label}</button>
  )
}
