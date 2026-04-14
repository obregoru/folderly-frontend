import { useState, useEffect } from 'react'
import * as api from '../api'

const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', blog: 'WordPress' }
const PLATFORM_COLORS = { facebook: '#1877F2', instagram: '#E1306C', twitter: '#000', blog: '#21759B' }
const STATUS_COLORS = { pending: '#6C5CE7', posted: '#2D9A5E', failed: '#c0392b', cancelled: '#999' }

export default function ScheduledPosts() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  const load = async () => {
    try {
      const data = await api.getScheduledPosts({ status: 'pending', limit: 20 })
      if (data.posts) setPosts(data.posts)
      else if (Array.isArray(data)) setPosts(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCancel = async (uuid) => {
    try {
      await api.cancelScheduledPost(uuid)
      load()
    } catch (err) {
      alert('Cancel failed: ' + err.message)
    }
  }

  const handleRetry = async (uuid) => {
    try {
      await api.retryScheduledPost(uuid)
      load()
    } catch (err) {
      alert('Retry failed: ' + err.message)
    }
  }

  const handleDelete = async (uuid) => {
    try {
      await api.deleteScheduledPost(uuid)
      load()
    } catch {}
  }

  if (loading) return null

  const pending = posts.filter(p => p.status === 'pending')
  const completed = posts.filter(p => p.status !== 'pending')

  if (posts.length === 0) return null

  return (
    <div className="bg-white border border-border rounded mb-2.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-2.5 px-3.5 border-b border-border bg-[#f3f0ff] rounded-t cursor-pointer border-none font-sans"
      >
        <span className="text-xs font-medium text-[#6C5CE7]">
          Scheduled Posts {pending.length > 0 && `(${pending.length} pending)`}
        </span>
        <span className="text-[10px] text-muted">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded && (
        <div className="divide-y divide-border">
          {pending.length > 0 && (
            <div className="px-3.5 py-2">
              <div className="text-[10px] text-muted uppercase tracking-wide mb-1.5">Upcoming</div>
              {pending.map(p => (
                <PendingRow key={p.uuid} post={p} onCancel={handleCancel} onReload={load} />
              ))}
            </div>
          )}

          {completed.length > 0 && (
            <div className="px-3.5 py-2">
              <div className="text-[10px] text-muted uppercase tracking-wide mb-1.5">History</div>
              {completed.slice(0, 10).map(p => (
                <div key={p.uuid} className="flex items-center justify-between py-1 gap-2">
                  {p.image_url && (
                    p.media_type?.startsWith('video/') ? (
                      <video src={p.image_url} className="w-7 h-7 rounded-sm object-cover flex-shrink-0 bg-black" muted playsInline preload="metadata" crossOrigin="anonymous" />
                    ) : (
                      <img src={p.image_url} className="w-7 h-7 rounded-sm object-cover flex-shrink-0" />
                    )
                  )}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[p.status] }} />
                    <span className="text-[10px] font-medium" style={{ color: PLATFORM_COLORS[p.platform] }}>
                      {PLATFORM_LABELS[p.platform] || p.platform}
                    </span>
                    <span className="text-[10px] text-muted capitalize">{p.status}</span>
                    {p.error_message && (
                      <span className="text-[10px] text-[#c0392b] truncate" title={p.error_message}>
                        {p.error_message.slice(0, 40)}
                      </span>
                    )}
                    {p.posted_at && (
                      <span className="text-[10px] text-muted">
                        {new Date(p.posted_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {p.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(p.uuid)}
                        className="text-[10px] text-[#6C5CE7] hover:underline"
                      >Retry now</button>
                    )}
                    <button
                      onClick={() => handleDelete(p.uuid)}
                      className="text-[10px] text-muted hover:underline"
                    >Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-3.5 py-1.5">
            <button onClick={load} className="text-[10px] text-muted hover:underline">Refresh</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PendingRow({ post, onCancel, onReload }) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(post.caption || '')
  const [title, setTitle] = useState(post.title || '')
  const [saving, setSaving] = useState(false)
  const p = post
  const needsTitle = p.platform === 'blog' || p.platform === 'youtube'

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateScheduledPost(p.uuid, { caption, title: needsTitle ? title : undefined })
      setEditing(false)
      onReload()
    } catch (err) {
      alert('Save failed: ' + err.message)
    }
    setSaving(false)
  }

  if (editing) {
    return (
      <div className="py-2 border-b border-border last:border-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-medium" style={{ color: PLATFORM_COLORS[p.platform] }}>
            {PLATFORM_LABELS[p.platform] || p.platform}
          </span>
          <span className="text-[10px] text-muted">
            {new Date(p.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        {needsTitle && (
          <input
            className="w-full text-[11px] border border-border rounded py-1 px-1.5 mb-1 bg-white"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title"
          />
        )}
        <textarea
          rows={4}
          className="w-full text-[11px] border border-border rounded py-1 px-1.5 bg-white resize-y"
          value={caption}
          onChange={e => setCaption(e.target.value)}
        />
        <div className="flex gap-1 mt-1">
          <button onClick={handleSave} disabled={saving} className="text-[10px] py-0.5 px-2 bg-[#6C5CE7] text-white rounded cursor-pointer border-none disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={() => { setCaption(p.caption || ''); setTitle(p.title || ''); setEditing(false) }} className="text-[10px] py-0.5 px-2 border border-border text-muted rounded cursor-pointer bg-white">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between py-1.5 gap-2">
      {p.image_url && (
        p.media_type?.startsWith('video/') ? (
          <video src={p.image_url} className="w-10 h-10 rounded-sm object-cover flex-shrink-0 bg-black" muted playsInline preload="metadata" crossOrigin="anonymous" />
        ) : (
          <img src={p.image_url} className="w-10 h-10 rounded-sm object-cover flex-shrink-0" />
        )
      )}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditing(true)} title="Click to edit">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium" style={{ color: PLATFORM_COLORS[p.platform] }}>
            {PLATFORM_LABELS[p.platform] || p.platform}
          </span>
          <span className="text-[10px] text-muted">
            {new Date(p.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        <div className="text-[10px] text-ink truncate mt-0.5" title={p.caption}>
          {p.title ? <><strong>{p.title}</strong> — </> : ''}{(p.caption || '').slice(0, 80)}{(p.caption || '').length > 80 ? '...' : ''}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button onClick={() => setEditing(true)} className="text-[10px] text-[#6C5CE7] hover:underline">Edit</button>
        <button onClick={() => onCancel(p.uuid)} className="text-[10px] text-red-500 hover:underline">Cancel</button>
      </div>
    </div>
  )
}
