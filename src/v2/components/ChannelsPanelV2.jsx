import { useEffect, useMemo, useState } from 'react'
import * as api from '../../api'
import { toBase64 } from '../../lib/crop'

/**
 * ChannelsPanelV2 — destinations + scheduling. Per-channel toggles
 * read/write the first file's post_destinations JSONB column so real
 * app + v2 share state.
 *
 * Scheduling: one scheduled_at for all enabled destinations. Builds one
 * scheduled_posts row per destination with the right platform + media
 * (merged base64 for multi-clip merges, upload_key for single files,
 * base64 for photo-only posts). Captions come from the first file's
 * captions JSONB — same column PostTextPanelV2 writes.
 */

const CHANNELS = [
  { key: 'tiktok',   label: 'TikTok',             icon: 'TT',  requiresVideo: true,  platform: 'tiktok',           captionKey: 'tiktok'    },
  { key: 'ig_reel',  label: 'Instagram Reel',     icon: 'IG',  requiresVideo: true,  platform: 'instagram',        captionKey: 'instagram' },
  { key: 'fb_reel',  label: 'Facebook Reel',      icon: 'FB',  requiresVideo: true,  platform: 'facebook_reel',    captionKey: 'facebook'  },
  { key: 'yt_short', label: 'YouTube Shorts',     icon: 'YT',  requiresVideo: true,  platform: 'youtube',          captionKey: 'youtube'   },
  { key: 'ig_story', label: 'Instagram Story',    icon: 'IG',  requiresVideo: false, platform: 'instagram_story',  captionKey: 'instagram' },
  { key: 'fb_story', label: 'Facebook Story',     icon: 'FB',  requiresVideo: false, platform: 'facebook_story',   captionKey: 'facebook'  },
  { key: 'fb_post',  label: 'Facebook Post',      icon: 'FB',  requiresVideo: false, platform: 'facebook',         captionKey: 'facebook'  },
  { key: 'blog',     label: 'Blog',               icon: 'BL',  requiresVideo: false, platform: 'blog',             captionKey: 'blog'      },
  { key: 'gbp',      label: 'Google Business',    icon: 'GBP', requiresVideo: false, platform: 'google',           captionKey: 'google'    },
]

function defaultScheduledAt() {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}
function toLocalInput(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ChannelsPanelV2({ draftId, files }) {
  const [destinations, setDestinations] = useState({})
  const [captions, setCaptions] = useState({})
  const [firstFileDbId, setFirstFileDbId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [whenInput, setWhenInput] = useState(toLocalInput(defaultScheduledAt()))
  const [scheduling, setScheduling] = useState(false)
  const [schedMsg, setSchedMsg] = useState(null)
  const [schedErr, setSchedErr] = useState(null)

  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(job => {
      const f0 = job?.files?.[0]
      if (f0) {
        setFirstFileDbId(f0.id)
        const dest = f0.post_destinations && typeof f0.post_destinations === 'object' ? f0.post_destinations : {}
        setDestinations(dest)
        const caps = f0.captions && typeof f0.captions === 'object' ? f0.captions : {}
        setCaptions(caps)
      }
    }).catch(() => {})
  }, [draftId])

  const toggle = async (key) => {
    const next = { ...destinations, [key]: !destinations[key] }
    setDestinations(next)
    if (!draftId || !firstFileDbId) return
    setSaving(true)
    try {
      await api.updateJobFile(draftId, firstFileDbId, { post_destinations: next })
    } catch (e) {
      console.warn('[ChannelsV2] save failed:', e.message)
    }
    setSaving(false)
  }

  const enabledCount = Object.values(destinations).filter(Boolean).length
  const enabledChannels = useMemo(
    () => CHANNELS.filter(c => destinations[c.key]),
    [destinations]
  )

  // Work out what media we have. mergedBase64 wins (multi-clip merges are
  // client-side only — there's no server copy to reference by upload_key).
  // Else single-video upload_key. Else photo base64.
  const mergeMeta = typeof window !== 'undefined' ? window._postyMergedVideo : null
  const videoFiles = (files || []).filter(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  const photoFiles = (files || []).filter(f => f.file?.type?.startsWith('image/') || f._mediaType?.startsWith('image/'))
  const hasMerge = !!(mergeMeta?.base64 || mergeMeta?.url || mergeMeta?.blob)
  const hasSingleVideo = !hasMerge && videoFiles.length === 1
  const hasPhotos = photoFiles.length > 0 && videoFiles.length === 0
  const canProduceVideo = hasMerge || hasSingleVideo
  const canSchedule = files.length > 0 && enabledCount > 0 && !!firstFileDbId

  const buildMedia = async () => {
    // Returns { image_base64, upload_key, media_type } for video/photo paths
    if (hasMerge) {
      let base64 = mergeMeta.base64
      if (!base64) {
        const blob = mergeMeta.blob || await (await fetch(mergeMeta.url)).blob()
        base64 = await toBase64(blob)
        try { window._postyMergedVideo = { ...mergeMeta, base64 } } catch {}
      }
      return { image_base64: base64, upload_key: null, media_type: 'video/mp4' }
    }
    if (hasSingleVideo) {
      const v = videoFiles[0]
      return {
        image_base64: null,
        upload_key: v.uploadResult?.original_temp_path || v._uploadKey || null,
        media_type: v.file?.type || v._mediaType || 'video/mp4',
      }
    }
    // Photo path — first image
    const p0 = photoFiles[0]
    if (p0?.file) {
      const b = await toBase64(p0.file)
      return { image_base64: b, upload_key: null, media_type: p0.file.type || 'image/jpeg' }
    }
    if (p0?._uploadKey) {
      return {
        image_base64: null,
        upload_key: p0._uploadKey,
        media_type: p0._mediaType || 'image/jpeg',
      }
    }
    throw new Error('No usable media on this draft')
  }

  const captionFor = (ch) => {
    const raw = captions[ch.captionKey]
    if (!raw) return { caption: '', title: null }
    if (typeof raw === 'string') return { caption: raw, title: null }
    if (ch.captionKey === 'youtube') return { caption: raw.description || raw.text || '', title: raw.title || null }
    if (ch.captionKey === 'blog')    return { caption: raw.text || '',                   title: raw.title || null }
    return { caption: raw.text || raw.description || '', title: raw.title || null }
  }

  const scheduleAll = async () => {
    setSchedMsg(null); setSchedErr(null)
    if (!canSchedule) return
    const when = new Date(whenInput)
    if (isNaN(when.getTime()) || when <= new Date()) {
      setSchedErr('Pick a future date/time.'); return
    }
    setScheduling(true)
    try {
      const media = await buildMedia()
      const isVideoMedia = (media.media_type || '').startsWith('video/')
      const primaryFile = files[0]
      const jobName = primaryFile?.job_name || primaryFile?.file?.name?.replace(/\.[^.]+$/, '') || 'v2 post'
      const posts = []
      const skipped = []
      for (const ch of enabledChannels) {
        if (ch.requiresVideo && !isVideoMedia) { skipped.push(`${ch.label} (needs video)`); continue }
        const { caption, title } = captionFor(ch)
        if (!caption && ch.key !== 'gbp') { skipped.push(`${ch.label} (empty caption)`); continue }
        const post = {
          platform: ch.platform,
          caption: caption || '',
          image_base64: media.image_base64,
          upload_key:   media.upload_key,
          media_type:   media.media_type,
          job_name:     jobName,
          job_uuid:     draftId || null,
        }
        if ((ch.key === 'blog' || ch.key === 'yt_short') && title) post.title = title
        posts.push(post)
      }
      if (posts.length === 0) {
        setSchedErr(skipped.length ? `Nothing scheduled — ${skipped.join(', ')}` : 'Nothing scheduled.')
      } else {
        const res = await api.schedulePosts(posts, when.toISOString())
        const n = res?.scheduled?.length || posts.length
        setSchedMsg(`Scheduled ${n} post${n === 1 ? '' : 's'} for ${when.toLocaleString()}${skipped.length ? ` · skipped ${skipped.join(', ')}` : ''}`)
      }
    } catch (e) {
      setSchedErr(e.message || String(e))
    } finally {
      setScheduling(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Destinations</div>
        {saving && <span className="text-[9px] text-muted">Saving…</span>}
        <span className="text-[9px] text-muted">{enabledCount} enabled</span>
      </div>

      <div className="text-[10px] text-muted">
        Each channel uses the shared video / photo + its per-platform caption from the Captions tab.
      </div>

      <div className="space-y-1.5">
        {CHANNELS.map(c => {
          const enabled = !!destinations[c.key]
          const blocked = c.requiresVideo && !canProduceVideo
          return (
            <div
              key={c.key}
              className={`border rounded-lg p-2.5 ${enabled ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white'} ${blocked ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[9px] font-bold text-[#6C5CE7] flex-shrink-0">
                  {c.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium">{c.label}</div>
                  <div className="text-[9px] text-muted">
                    {blocked ? 'needs a video' : (c.requiresVideo ? 'video required' : 'photo or video')}
                  </div>
                </div>
                <label className="relative inline-block w-10 h-6 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggle(c.key)}
                    disabled={blocked}
                    className="sr-only peer"
                  />
                  <span className="absolute inset-0 bg-[#e5e5e5] rounded-full peer-checked:bg-[#2D9A5E] transition-colors" />
                  <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
        <div className="text-[12px] font-medium">Schedule</div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[10px] text-muted">When:</label>
          <input
            type="datetime-local"
            value={whenInput}
            onChange={e => setWhenInput(e.target.value)}
            className="text-[11px] border border-[#e5e5e5] rounded py-1 px-2 bg-white"
          />
          <div className="flex gap-1">
            <button
              onClick={() => { const d = new Date(); d.setHours(d.getHours()+1,0,0,0); setWhenInput(toLocalInput(d)) }}
              className="text-[9px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer"
            >+1h</button>
            <button
              onClick={() => { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); setWhenInput(toLocalInput(d)) }}
              className="text-[9px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer"
            >Tomorrow 9am</button>
            <button
              onClick={() => { const d = new Date(); const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate()+daysUntilSat); d.setHours(11,0,0,0); setWhenInput(toLocalInput(d)) }}
              className="text-[9px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer"
            >Next Sat 11am</button>
          </div>
        </div>

        <button
          onClick={scheduleAll}
          disabled={!canSchedule || scheduling}
          className="w-full text-[11px] py-2 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scheduling ? 'Scheduling…' : `Schedule ${enabledCount} destination${enabledCount === 1 ? '' : 's'}`}
        </button>

        {schedMsg && <div className="text-[10px] text-[#2D9A5E] bg-[#f0faf4] border border-[#2D9A5E]/30 rounded p-2">{schedMsg}</div>}
        {schedErr && <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">{schedErr}</div>}

        <div className="text-[9px] text-muted italic">
          Best-time suggestions + staggered per-platform times land in a later sub-phase. For now, one time → all destinations.
        </div>
      </div>
    </div>
  )
}
