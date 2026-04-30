// Modal picker that lists media the tenant has previously uploaded
// (across any job) and lets the user import one or many items into
// the current draft. Backend does a server-side supabase copy so the
// imported file isn't tied to the source job — if the source job
// gets cleaned up later, the copy stays.
//
// Tenant scoping: the listMediaLibrary endpoint queries job_files
// joined to jobs WHERE jobs.tenant_id = req.tenant.id, so the user
// only ever sees their own media.
//
// Mounted as a fullscreen overlay from the media panel's "Browse
// uploads" button. onPicked fires with the imported item's metadata
// once the BE copy + insert finishes; the parent prepends it to the
// editor's files list so the new clip lands in the panel without
// a manual reload.

import { useEffect, useState } from 'react'
import * as api from '../../api'

export default function MediaLibraryPicker({ destJobUuid, onPicked, onClose, kind = 'all' }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Map of file_hash → 'importing' | 'done' | 'error' so we can
  // disable a tile while its copy is in flight + show success state
  // if the user picks several without closing the modal.
  const [importStatus, setImportStatus] = useState({})
  const [activeKind, setActiveKind] = useState(kind)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    api.listMediaLibrary({ kind: activeKind, limit: 200 })
      .then(r => {
        if (cancelled) return
        setItems(Array.isArray(r?.items) ? r.items : [])
      })
      .catch(e => {
        if (cancelled) return
        setError(e?.message || String(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeKind])

  const importItem = async (it) => {
    if (!destJobUuid) {
      setError('No destination job — open a draft first.')
      return
    }
    setImportStatus(prev => ({ ...prev, [it.file_hash]: 'importing' }))
    try {
      const r = await api.importMediaToJob(destJobUuid, {
        source_upload_key: it.upload_key,
        filename: it.filename,
        media_type: it.media_type,
        file_hash: it.file_hash,
        photo_to_video_duration: it.photo_to_video_duration,
        photo_to_video_motion: it.photo_to_video_motion,
      })
      setImportStatus(prev => ({ ...prev, [it.file_hash]: 'done' }))
      if (typeof onPicked === 'function') {
        onPicked({ ...it, imported: r?.file })
      }
    } catch (e) {
      setImportStatus(prev => ({ ...prev, [it.file_hash]: 'error' }))
      setError(e?.message || String(e))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e5e5e5]">
          <span className="text-[16px]">📚</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">Your media library</div>
            <div className="text-[10px] text-muted">
              Pick a file to copy into this draft. Your other jobs aren't affected.
            </div>
          </div>
          {/* Kind filter — match the upload context. Hidden when the
              caller pinned a specific kind (e.g. video-only drafts). */}
          <div className="flex items-center gap-1">
            <KindButton label="All" active={activeKind === 'all'} onClick={() => setActiveKind('all')} />
            <KindButton label="Videos" active={activeKind === 'video'} onClick={() => setActiveKind('video')} />
            <KindButton label="Photos" active={activeKind === 'image'} onClick={() => setActiveKind('image')} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >✕ Close</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="text-[12px] text-muted italic text-center py-12">Loading…</div>
          )}
          {error && (
            <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 mb-2">
              {error}
            </div>
          )}
          {!loading && items.length === 0 && !error && (
            <div className="text-[12px] text-muted italic text-center py-12">
              No media found. Upload a file in any draft and it'll appear here.
            </div>
          )}
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map((it) => {
                const status = importStatus[it.file_hash]
                const importing = status === 'importing'
                const done = status === 'done'
                const failed = status === 'error'
                return (
                  <button
                    key={it.upload_key}
                    type="button"
                    onClick={() => importItem(it)}
                    disabled={importing || done}
                    className={`group block text-left bg-[#fafafa] border rounded overflow-hidden cursor-pointer transition disabled:cursor-default ${
                      done ? 'border-[#2D9A5E]'
                        : failed ? 'border-[#c0392b]'
                        : 'border-[#e5e5e5] hover:border-[#6C5CE7]'
                    }`}
                  >
                    <div className="relative aspect-square bg-black flex items-center justify-center text-white">
                      {it.thumb_url ? (
                        <img
                          src={it.thumb_url}
                          alt={it.filename}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[24px] opacity-60">{it.is_video ? '🎬' : '🖼️'}</span>
                      )}
                      {/* Type tag in corner */}
                      <span className="absolute top-1 left-1 text-[9px] bg-black/60 text-white rounded px-1 py-0.5">
                        {it.is_video ? 'video' : it.is_image ? 'photo' : 'media'}
                      </span>
                      {/* Status overlay during/after import */}
                      {(importing || done || failed) && (
                        <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                          <span className="text-[12px] font-medium">
                            {importing ? 'Copying…' : done ? '✓ Imported' : '✕ Failed'}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-1.5">
                      <div className="text-[10px] font-medium truncate" title={it.filename}>
                        {it.filename}
                      </div>
                      <div className="text-[9px] text-muted truncate">
                        from {it.job_name || 'untitled draft'}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-[#e5e5e5] flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] py-1.5 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >Done</button>
        </div>
      </div>
    </div>
  )
}

function KindButton({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] py-1 px-2 border rounded cursor-pointer ${
        active
          ? 'border-[#6C5CE7] bg-[#6C5CE7]/10 text-[#6C5CE7]'
          : 'border-[#e5e5e5] bg-white text-muted'
      }`}
    >{label}</button>
  )
}
