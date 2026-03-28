import { useState, useEffect } from 'react'
import * as api from '../api'

const PLATFORMS = [
  { k: 'tiktok', l: 'TikTok', c: 'text-tk border-tk' },
  { k: 'instagram', l: 'Instagram', c: 'text-ig border-ig' },
  { k: 'facebook', l: 'Facebook', c: 'text-fb border-fb' },
  { k: 'twitter', l: 'X', c: 'text-tw border-tw' },
  { k: 'google', l: 'Google', c: 'text-gb border-gb' },
  { k: 'blog', l: 'Blog', c: 'text-blog border-blog' },
]

function fmtDate(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function HistoryItem({ g, gi }) {
  const [activeTab, setActiveTab] = useState(null)
  const platDefs = PLATFORMS.filter(p => g.platforms[p.k])
  if (platDefs.length && !activeTab) setTimeout(() => setActiveTab(platDefs[0].k), 0)

  return (
    <div className="border border-border rounded-sm mb-2.5 overflow-hidden">
      <div className="flex items-center gap-2.5 py-2 px-3 bg-cream">
        {g.thumbnail_path && (
          <img src={g.thumbnail_path.startsWith('http') ? g.thumbnail_path : `/uploads/${g.thumbnail_path}`} className="w-12 h-12 object-cover rounded-sm flex-shrink-0" />
        )}
        <div>
          <div className="text-xs font-medium">{g.filename}</div>
          <div className="text-[11px] text-muted">{g.folder ? g.folder + ' · ' : ''}{fmtDate(g.created_at)}</div>
        </div>
      </div>
      {platDefs.length > 0 && (
        <>
          <div className="flex border-b border-border">
            {platDefs.map(p => (
              <button
                key={p.k}
                className={`flex-1 py-1.5 px-1 text-[11px] font-medium text-center cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-px ${activeTab === p.k ? p.c : 'text-muted border-transparent'}`}
                onClick={() => setActiveTab(p.k)}
              >{p.l}</button>
            ))}
          </div>
          {platDefs.map(p => activeTab === p.k && (
            <div key={p.k} className="py-2.5 px-3 text-xs leading-relaxed whitespace-pre-wrap">{g.platforms[p.k]}</div>
          ))}
        </>
      )}
    </div>
  )
}

export default function HistoryModal({ onClose }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    api.getHistory(80).then(setRows).catch(() => setRows([]))
  }, [])

  // Group by batch then by filename
  const grouped = []
  const batches = {}
  const noBatch = []

  if (rows) {
    rows.forEach(row => {
      const fileKey = row.filename + '__' + (row.created_at || '').slice(0, 16)
      const entry = { filename: row.filename, folder: row.folder_name || row.batch_folder || '', created_at: row.created_at, thumbnail_path: row.thumbnail_path || row.thumbnail_url, platform: row.platform, caption_text: row.caption_text }

      if (row.batch_id) {
        if (!batches[row.batch_id]) batches[row.batch_id] = { id: row.batch_id, folder: row.batch_folder || row.folder_name || '', created_at: row.created_at, file_count: row.batch_file_count, files: {} }
        if (!batches[row.batch_id].files[fileKey]) batches[row.batch_id].files[fileKey] = { filename: row.filename, thumbnail_path: row.thumbnail_path || row.thumbnail_url, created_at: row.created_at, platforms: {} }
        batches[row.batch_id].files[fileKey].platforms[row.platform] = row.caption_text
      } else {
        let existing = noBatch.find(x => x._key === fileKey)
        if (!existing) { existing = { _key: fileKey, filename: row.filename, folder: row.folder_name || '', thumbnail_path: row.thumbnail_path || row.thumbnail_url, created_at: row.created_at, platforms: {} }; noBatch.push(existing) }
        existing.platforms[row.platform] = row.caption_text
      }
    })
  }

  return (
    <div className="fixed inset-0 bg-black/45 z-[200] flex items-center justify-center" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded w-[640px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between py-3.5 px-4.5 border-b border-border">
          <div className="font-serif text-[17px]">Content history</div>
          <button className="text-xl bg-transparent border-none cursor-pointer text-muted" onClick={onClose}>×</button>
        </div>
        <div className="overflow-y-auto py-3.5 px-4.5">
          {!rows && <div className="text-xs text-muted p-4">Loading...</div>}
          {rows && rows.length === 0 && (
            <div className="text-center py-10 text-muted text-[13px]">
              <strong className="block font-serif text-lg text-ink mb-1">No history yet</strong>
              Generate some captions first
            </div>
          )}
          {/* Batches */}
          {Object.values(batches).map(batch => (
            <div key={batch.id} className="mb-4 border border-border rounded overflow-hidden">
              <div className="py-2 px-3.5 bg-sage-light text-xs font-medium flex justify-between">
                <span>{batch.folder ? batch.folder + '/' : 'Batch upload'}</span>
                <span className="text-muted">{batch.file_count || Object.keys(batch.files).length} files · {fmtDate(batch.created_at)}</span>
              </div>
              {Object.values(batch.files).map((g, gi) => <HistoryItem key={gi} g={g} gi={gi} />)}
            </div>
          ))}
          {/* Unbatched */}
          {noBatch.map((g, gi) => <HistoryItem key={gi} g={g} gi={gi} />)}
        </div>
      </div>
    </div>
  )
}
