import { useState, useEffect } from 'react'
import * as api from '../../api'

/**
 * v2 Drafts screen — real data, mockup layout.
 * Uses jobSync.jobList for the list. Each row is card-style with
 * name primary, meta subtitle, action row below.
 */
export default function DraftsV2({ jobSync, onOpen, onNew }) {
  const [renamingId, setRenamingId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [duplicatingId, setDuplicatingId] = useState(null)

  // Refresh the jobs list when the drafts screen mounts so newly-created
  // drafts appear without a manual refresh.
  useEffect(() => {
    if (jobSync.refreshJobList) jobSync.refreshJobList()
  }, [])

  const drafts = (jobSync.jobList || []).filter(j => j.status === 'draft' && (j.file_count > 0 || j.hint_text || j.job_name))

  const startRename = (j) => {
    setRenamingId(j.uuid)
    setRenameDraft(j.job_name || '')
  }
  const commitRename = async (j) => {
    const next = renameDraft.trim()
    setRenamingId(null)
    if (!next || next === (j.job_name || '')) return
    try {
      await api.updateJob(j.uuid, { job_name: next })
      if (jobSync.refreshJobList) await jobSync.refreshJobList()
    } catch (e) { alert('Rename failed: ' + e.message) }
  }

  const ago = (dateStr) => {
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

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-[14px] font-medium flex-1">Drafts ({drafts.length})</h1>
        <button
          onClick={onNew}
          className="text-[11px] py-1.5 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer font-medium"
        >+ New draft</button>
      </div>

      {drafts.length === 0 && (
        <div className="text-[11px] text-muted italic text-center py-8 bg-white border border-[#e5e5e5] rounded-lg">
          No drafts yet. Tap <b>+ New draft</b> to start.
        </div>
      )}

      <div className="space-y-2">
        {drafts.map(j => {
          const isRenaming = renamingId === j.uuid
          return (
            <div
              key={j.uuid}
              className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden"
            >
              <div
                onClick={() => !isRenaming && onOpen(j.uuid)}
                className={`flex items-start gap-3 p-3 ${isRenaming ? '' : 'cursor-pointer active:bg-[#f8f7f3]'}`}
              >
                <div className="w-[60px] h-[80px] rounded bg-[#e5e5e5] flex-shrink-0 flex items-center justify-center text-[10px] text-muted">
                  {j.file_count > 0 ? <span className="text-[18px]">🎬</span> : 'empty'}
                </div>
                <div className="flex-1 min-w-0">
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={e => setRenameDraft(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(j) }
                        else if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null) }
                      }}
                      onBlur={() => commitRename(j)}
                      className="w-full text-[13px] font-medium border border-[#6C5CE7] rounded px-1 py-0.5 bg-white"
                    />
                  ) : (
                    <div
                      className="font-medium text-[13px] text-ink truncate"
                      onDoubleClick={e => { e.stopPropagation(); startRename(j) }}
                    >
                      {j.job_name || j.hint_text?.slice(0, 40) || 'Untitled draft'}
                    </div>
                  )}
                  <div className="text-[10px] text-muted mt-0.5 flex items-center gap-1 flex-wrap">
                    <span>{j.file_count || 0} file{j.file_count !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{ago(j.updated_at)}</span>
                    <span className="font-mono opacity-50 ml-auto">#{j.uuid?.slice(0, 8)}</span>
                  </div>
                  {!isRenaming && (
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      <button
                        onClick={e => { e.stopPropagation(); startRename(j) }}
                        className="text-[10px] text-muted bg-white border border-[#e5e5e5] rounded py-0.5 px-2 cursor-pointer"
                      >Rename</button>
                      <button
                        onClick={async e => {
                          e.stopPropagation()
                          if (duplicatingId) return
                          setDuplicatingId(j.uuid)
                          try { await jobSync.duplicateJob(j.uuid) }
                          catch (err) { alert('Duplicate failed: ' + err.message) }
                          finally { setDuplicatingId(null) }
                        }}
                        disabled={duplicatingId === j.uuid}
                        className="text-[10px] text-[#6C5CE7] bg-white border border-[#6C5CE7] rounded py-0.5 px-2 cursor-pointer disabled:opacity-50"
                      >{duplicatingId === j.uuid ? 'Copying…' : 'Duplicate'}</button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          if (confirm('Archive this draft?')) jobSync.archiveJob(j.uuid)
                        }}
                        className="text-[10px] text-[#c0392b] bg-white border border-[#c0392b] rounded py-0.5 px-2 cursor-pointer ml-auto"
                      >Archive</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
