import { useState } from 'react'

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

export default function JobList({ jobs, activeJobId, uploadsInProgress = 0, saving = false, onResume, onNew, onSave, onArchive, onDuplicate, onRename }) {
  const [expanded, setExpanded] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
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
            onClick={onNew}
            disabled={uploadsInProgress > 0}
            className="text-[10px] py-1 px-2.5 border border-[#2D9A5E] text-[#2D9A5E] rounded bg-white cursor-pointer hover:bg-[#f0faf4] disabled:opacity-40 disabled:cursor-not-allowed"
          >{uploadsInProgress > 0 ? `Saving ${uploadsInProgress} file${uploadsInProgress > 1 ? 's' : ''}...` : 'New job'}</button>
        </div>
      </div>

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
