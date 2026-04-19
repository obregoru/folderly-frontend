import { useState } from 'react'
import { sampleDrafts } from '../mockData'

/**
 * Drafts list screen. Collapses cleanly on mobile: each row is card-like
 * with the name as primary, meta as subtitle, actions as a compact row.
 */
export default function DraftsScreen({ onOpen }) {
  const [drafts, setDrafts] = useState(sampleDrafts)

  const handleNew = () => {
    const id = `m-${Date.now()}`
    setDrafts(prev => [
      { id, name: 'Untitled draft', updatedAt: 'just now', fileCount: 0, thumb: null },
      ...prev,
    ])
    onOpen(id)
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-[14px] font-medium flex-1">Drafts</h1>
        <button
          onClick={handleNew}
          className="text-[11px] py-1.5 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer font-medium"
        >+ New draft</button>
      </div>

      <div className="space-y-2">
        {drafts.map(d => (
          <div
            key={d.id}
            className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden cursor-pointer active:bg-[#f8f7f3]"
            onClick={() => onOpen(d.id)}
          >
            <div className="flex items-start gap-3 p-3">
              {d.thumb ? (
                <img
                  src={d.thumb}
                  alt=""
                  className="w-[60px] h-[80px] rounded object-cover flex-shrink-0 bg-[#e5e5e5]"
                />
              ) : (
                <div className="w-[60px] h-[80px] rounded bg-[#e5e5e5] flex-shrink-0 flex items-center justify-center text-[10px] text-muted">
                  empty
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13px] text-ink truncate">{d.name}</div>
                <div className="text-[10px] text-muted mt-0.5 flex items-center gap-1 flex-wrap">
                  <span>{d.fileCount} file{d.fileCount === 1 ? '' : 's'}</span>
                  <span>·</span>
                  <span>{d.updatedAt}</span>
                  <span className="font-mono opacity-50 ml-auto">#{d.id.slice(-4)}</span>
                </div>
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  <button onClick={e => e.stopPropagation()} className="text-[10px] text-muted bg-white border border-[#e5e5e5] rounded py-0.5 px-2 cursor-pointer">Rename</button>
                  <button onClick={e => e.stopPropagation()} className="text-[10px] text-[#6C5CE7] bg-white border border-[#6C5CE7] rounded py-0.5 px-2 cursor-pointer">Duplicate</button>
                  <button onClick={e => e.stopPropagation()} className="text-[10px] text-[#c0392b] bg-white border border-[#c0392b] rounded py-0.5 px-2 cursor-pointer ml-auto">Archive</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
