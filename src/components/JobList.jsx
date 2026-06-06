import { useState } from 'react'
import * as api from '../api'

function timeAgo(dateStr) {
  const d = new Date(dateStr)
  const now = Date.now()
  const diff = now - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

export default function JobList({ jobs, activeJobId, uploadsInProgress = 0, saving = false, onResume, onNew, onSave, onArchive, onDuplicate, onRename, onCampaignCreated }) {
  const [expanded, setExpanded] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [campaignOpen, setCampaignOpen] = useState(false)
  const drafts = jobs.filter(j => j.status === 'draft' && (j.file_count > 0 || j.hint_text || j.job_name))

  const startRename = (j) => {
    setRenamingId(j.uuid)
    setRenameDraft(j.job_name || '')
  }
  const commitRename = async (j) => {
    const next = renameDraft.trim()
    setRenamingId(null)
    if (!next || next === (j.job_name || '') || !onRename) return
    try { await onRename(j.uuid, next) } catch (e) { alert('Rename failed: ' + e.message) }
  }
  const cancelRename = () => { setRenamingId(null); setRenameDraft('') }

  return (
    <div className="bg-white border border-border rounded-sm p-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] font-medium text-ink bg-transparent border-none cursor-pointer p-0 flex items-center gap-1"
        >
          Saved drafts ({drafts.length})
          <span className="text-[9px] text-muted">{expanded ? '▲' : '▼'}</span>
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={async () => { if (onSave) { await onSave(); setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) } }}
            disabled={uploadsInProgress > 0 || saving}
            className={`text-[10px] py-1 px-2.5 border rounded bg-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${justSaved ? 'border-[#2D9A5E] text-[#2D9A5E]' : 'border-[#6C5CE7] text-[#6C5CE7] hover:bg-[#f3f0ff]'}`}
          >{saving ? 'Saving...' : justSaved ? 'Saved' : 'Save'}</button>
          <button
            onClick={() => setCampaignOpen(true)}
            disabled={uploadsInProgress > 0}
            className="text-[10px] py-1 px-2.5 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer hover:bg-[#f3f0ff] disabled:opacity-40 disabled:cursor-not-allowed"
            title="Paste a multi-video campaign brief and build N draft jobs at once (one per video defined in the brief). Each job records which campaign it came from."
          >✨ Build from campaign</button>
          <button
            onClick={onNew}
            disabled={uploadsInProgress > 0}
            className="text-[10px] py-1 px-2.5 border border-[#2D9A5E] text-[#2D9A5E] rounded bg-white cursor-pointer hover:bg-[#f0faf4] disabled:opacity-40 disabled:cursor-not-allowed"
          >{uploadsInProgress > 0 ? `Saving ${uploadsInProgress} file${uploadsInProgress > 1 ? 's' : ''}...` : 'New job'}</button>
        </div>
      </div>

      {campaignOpen && (
        <CampaignBuilderModal
          onClose={() => setCampaignOpen(false)}
          onCreated={async (created) => {
            setCampaignOpen(false)
            if (typeof onCampaignCreated === 'function') await onCampaignCreated(created)
          }}
        />
      )}

      {expanded && (
        <div className="mt-2 space-y-1">
          {drafts.length === 0 && (
            <p className="text-[10px] text-muted">No saved drafts. Your work will be auto-saved as you go.</p>
          )}
          {drafts.map(j => {
            const isRenaming = renamingId === j.uuid
            const isActive = j.uuid === activeJobId
            return (
              <div
                key={j.uuid}
                className={`rounded text-[10px] ${isActive ? 'bg-[#f0faf4] border border-[#2D9A5E]/30' : 'bg-[#f8f9fa]'} ${isRenaming ? '' : 'cursor-pointer hover:bg-cream'}`}
                onClick={() => {
                  if (isRenaming) return
                  onResume(j.uuid)
                  // Auto-collapse the draft list after selecting — user
                  // requested rolled-up behavior once a draft is active.
                  setExpanded(false)
                }}
              >
                {/* Row 1: job name — primary, large, truncates cleanly */}
                <div className="px-2 pt-1.5">
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={e => setRenameDraft(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(j) }
                        else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                      }}
                      onBlur={() => commitRename(j)}
                      className="w-full text-[11px] font-medium text-ink border border-[#6C5CE7] rounded px-1 py-0.5 bg-white"
                    />
                  ) : (
                    <div
                      className="font-medium text-ink truncate text-[11px]"
                      onDoubleClick={e => { e.stopPropagation(); startRename(j) }}
                      title="Double-click to rename"
                    >
                      {j.job_name || j.hint_text?.slice(0, 40) || 'Untitled draft'}
                      {isActive && <span className="text-[#2D9A5E] ml-1 text-[9px]">(current)</span>}
                    </div>
                  )}
                </div>
                {/* Row 2: time + file count + ID subtitle — horizontal, dimmer */}
                {!isRenaming && (
                  <div className="px-2 pb-1 text-[9px] text-muted flex items-center gap-1 flex-wrap">
                    <span>{j.file_count || 0} file{j.file_count !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{timeAgo(j.updated_at)}</span>
                    <span className="font-mono opacity-60 ml-auto" title={j.uuid}>#{j.uuid?.slice(0, 8)}</span>
                  </div>
                )}
                {/* Row 3: actions — horizontal row below, wraps when needed */}
                {!isRenaming && (
                  <div className="px-2 pb-1.5 flex items-center gap-1 flex-wrap">
                    {onRename && (
                      <button
                        onClick={(e) => { e.stopPropagation(); startRename(j) }}
                        className="text-[10px] text-muted hover:bg-cream bg-white border border-border rounded cursor-pointer py-0.5 px-2"
                        title="Rename this draft"
                      >Rename</button>
                    )}
                    {onDuplicate && (
                      <>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (duplicatingId) return
                            setDuplicatingId(j.uuid)
                            try { await onDuplicate(j.uuid) } finally { setDuplicatingId(null) }
                          }}
                          disabled={duplicatingId === j.uuid}
                          className="text-[10px] text-[#6C5CE7] hover:bg-[#f3f0ff] bg-white border border-[#6C5CE7] rounded cursor-pointer py-0.5 px-2 disabled:opacity-50"
                          title="Duplicate — copies all videos, audio, captions to a new job"
                        >{duplicatingId === j.uuid ? 'Copying…' : 'Duplicate'}</button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (duplicatingId) return
                            setDuplicatingId(j.uuid + ':hook')
                            try { await onDuplicate(j.uuid, { forceHookMode: true }) } finally { setDuplicatingId(null) }
                          }}
                          disabled={duplicatingId === j.uuid + ':hook'}
                          className="text-[10px] text-[#6C5CE7] hover:bg-[#f3f0ff] bg-white border border-[#6C5CE7] rounded cursor-pointer py-0.5 px-2 disabled:opacity-50"
                          title="Duplicate as hook — creates a reels-only copy (different captions, voiceover)"
                        >{duplicatingId === j.uuid + ':hook' ? 'Copying…' : 'Dup as hook'}</button>
                      </>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onArchive(j.uuid) }}
                      className="text-[10px] text-[#c0392b] hover:bg-[#fdeaea] bg-white border border-[#c0392b] rounded cursor-pointer py-0.5 px-2 ml-auto"
                      title="Archive this draft"
                    >Archive</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Modal that turns a pasted multi-video brief into N draft jobs.
// Two-phase: paste → ✨ Preview (calls /campaigns with dry_run=true
// to get parsed job cards) → operator reviews → ✓ Create N jobs
// (calls /campaigns with dry_run=false to persist). The campaign row
// stores the source text + title so later operators can trace back.
function CampaignBuilderModal({ onClose, onCreated }) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState('paste') // 'paste' | 'previewing' | 'preview' | 'creating'
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)

  const runPreview = async () => {
    const trimmed = text.trim()
    if (!trimmed) { setError('Paste a campaign brief first.'); return }
    setError(null); setPhase('previewing')
    try {
      const r = await api.previewCampaign(trimmed)
      setPreview(r)
      setPhase('preview')
    } catch (e) {
      setError(e?.message || String(e))
      setPhase('paste')
    }
  }

  const commit = async () => {
    if (phase === 'creating') return
    setError(null); setPhase('creating')
    try {
      const r = await api.createCampaign(text.trim())
      await onCreated(r)
    } catch (e) {
      setError(e?.message || String(e))
      setPhase('preview')
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-2"
      onClick={() => phase !== 'creating' && onClose()}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded shadow-xl border border-border w-full max-w-[760px] max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <span className="text-[12px] font-semibold">✨ Build jobs from campaign</span>
          <span className="text-[10px] text-muted flex-1">Paste a multi-video brief. We'll parse it into one draft job per video.</span>
          <button
            onClick={onClose}
            disabled={phase === 'creating'}
            className="text-[11px] py-0.5 px-2 bg-white border border-border rounded cursor-pointer disabled:opacity-50"
          >Close</button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {phase === 'paste' || phase === 'previewing' ? (
            <>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste the full campaign brief here. Include the overarching theme + each job block (we look for 'JOB N:' headings or '═══' separators)."
                disabled={phase === 'previewing'}
                className="w-full min-h-[320px] text-[11px] font-mono border border-border rounded p-2 outline-none focus:border-[#6C5CE7] resize-y"
              />
              {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted">{text.length.toLocaleString()} chars · {text.length > 80000 ? '⚠ too long (max 80k)' : 'we cap at 80k chars'}</span>
                <span className="flex-1" />
                <button
                  onClick={runPreview}
                  disabled={phase === 'previewing' || !text.trim() || text.length > 80000}
                  className="text-[11px] py-1 px-2.5 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer hover:bg-[#f3f0ff] disabled:opacity-40"
                >{phase === 'previewing' ? 'Parsing…' : '🔍 Preview parsed jobs'}</button>
              </div>
            </>
          ) : (
            <>
              {preview?.campaign?.campaign_title && (
                <div className="bg-[#fafbff] border border-[#6C5CE7]/30 rounded p-2">
                  <div className="text-[11px] font-semibold">{preview.campaign.campaign_title}</div>
                  {preview.campaign.campaign_tagline && (
                    <div className="text-[10px] text-muted italic mt-0.5">{preview.campaign.campaign_tagline}</div>
                  )}
                </div>
              )}
              <div className="text-[10px] text-muted">
                Parsed <b>{preview?.jobs?.length || 0}</b> video{(preview?.jobs?.length || 0) === 1 ? '' : 's'} in {preview?.parse_ms || 0}ms.
                Each will be created as a new <b>draft</b> job; pre-filled hint_text wraps the overlays, voiceover script, and hashtags so Producer + downstream tools see everything.
              </div>
              <div className="space-y-1.5">
                {(preview?.jobs || []).map((j, i) => (
                  <div key={i} className="border border-border rounded p-2 bg-[#fafafa]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono py-0.5 px-1 bg-[#e0e7ff] text-[#3730a3] rounded">JOB {i + 1}</span>
                      <span className="text-[11px] font-semibold">{j.job_name}</span>
                      {j.theme_tagline && <span className="text-[10px] italic text-muted">— {j.theme_tagline}</span>}
                    </div>
                    {j.about && (
                      <div className="text-[10px] text-ink mt-1 line-clamp-3">{j.about}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-[9px] text-muted">
                      <span>{(j.angles || []).length} angles</span>
                      <span>·</span>
                      <span>{(j.voiceover_segments || []).length} VO beats</span>
                      <span>·</span>
                      <span>{(j.hashtags || []).length} hashtags</span>
                      {(j.overlays?.opening || j.overlays?.middle || j.overlays?.closing) && (
                        <>
                          <span>·</span>
                          <span>3-slot overlays</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
            </>
          )}
        </div>

        {phase === 'preview' && (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
            <button
              onClick={() => { setPhase('paste'); setPreview(null) }}
              disabled={phase === 'creating'}
              className="text-[11px] py-1 px-2.5 border border-border rounded bg-white cursor-pointer disabled:opacity-50"
            >← Back to brief</button>
            <span className="flex-1" />
            <button
              onClick={commit}
              disabled={phase === 'creating' || !(preview?.jobs?.length)}
              className="text-[11px] py-1 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
            >{phase === 'creating' ? 'Creating jobs…' : `✓ Create ${preview?.jobs?.length || 0} job${(preview?.jobs?.length || 0) === 1 ? '' : 's'}`}</button>
          </div>
        )}
      </div>
    </div>
  )
}
