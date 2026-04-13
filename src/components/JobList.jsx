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

export default function JobList({ jobs, activeJobId, uploadsInProgress = 0, onResume, onNew, onArchive }) {
  const [expanded, setExpanded] = useState(false)
  const drafts = jobs.filter(j => j.status === 'draft' && (j.file_count > 0 || j.hint_text || j.job_name))

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
        <button
          onClick={onNew}
          disabled={uploadsInProgress > 0}
          className="text-[10px] py-1 px-2.5 border border-[#2D9A5E] text-[#2D9A5E] rounded bg-white cursor-pointer hover:bg-[#f0faf4] disabled:opacity-40 disabled:cursor-not-allowed"
        >{uploadsInProgress > 0 ? `Saving ${uploadsInProgress} file${uploadsInProgress > 1 ? 's' : ''}...` : 'New job'}</button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1">
          {drafts.length === 0 && (
            <p className="text-[10px] text-muted">No saved drafts. Your work will be auto-saved as you go.</p>
          )}
          {drafts.map(j => (
            <div
              key={j.uuid}
              className={`flex items-center gap-2 py-1.5 px-2 rounded text-[10px] cursor-pointer hover:bg-cream ${j.uuid === activeJobId ? 'bg-[#f0faf4] border border-[#2D9A5E]/30' : 'bg-[#f8f9fa]'}`}
              onClick={() => onResume(j.uuid)}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink truncate">
                  {j.job_name || j.hint_text?.slice(0, 40) || 'Untitled draft'}
                </div>
                <div className="text-[9px] text-muted">
                  {j.file_count || 0} file{j.file_count !== 1 ? 's' : ''} · {timeAgo(j.updated_at)}
                  {j.uuid === activeJobId && <span className="text-[#2D9A5E] ml-1">(current)</span>}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onArchive(j.uuid) }}
                className="text-[9px] text-muted hover:text-[#c0392b] bg-transparent border-none cursor-pointer px-1"
                title="Archive this draft"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
