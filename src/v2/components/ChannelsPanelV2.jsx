import { useEffect, useMemo, useState } from 'react'
import * as api from '../../api'
import { toBase64 } from '../../lib/crop'

/**
 * ChannelsPanelV2 — destinations + scheduling with AI best-time suggestions.
 *
 * Each destination can use a per-channel time override, or fall back to the
 * global "When" time. Best times come from /generate/posting-schedule (cached
 * per tenant), optionally informed by real analytics data from tenant settings.
 */

const CHANNELS = [
  { key: 'tiktok',   label: 'TikTok',             icon: 'TT',  requiresVideo: true,  platform: 'tiktok',           captionKey: 'tiktok',    aiName: 'TikTok' },
  { key: 'ig_reel',  label: 'Instagram Reel',     icon: 'IG',  requiresVideo: true,  platform: 'instagram',        captionKey: 'instagram', aiName: 'Instagram' },
  { key: 'fb_reel',  label: 'Facebook Reel',      icon: 'FB',  requiresVideo: true,  platform: 'facebook_reel',    captionKey: 'facebook',  aiName: 'Facebook' },
  { key: 'yt_short', label: 'YouTube Shorts',     icon: 'YT',  requiresVideo: true,  platform: 'youtube',          captionKey: 'youtube',   aiName: 'YouTube Shorts' },
  { key: 'ig_story', label: 'Instagram Story',    icon: 'IG',  requiresVideo: false, platform: 'instagram_story',  captionKey: 'instagram', aiName: 'Instagram' },
  { key: 'fb_story', label: 'Facebook Story',     icon: 'FB',  requiresVideo: false, platform: 'facebook_story',   captionKey: 'facebook',  aiName: 'Facebook' },
  { key: 'fb_post',  label: 'Facebook Post',      icon: 'FB',  requiresVideo: false, platform: 'facebook',         captionKey: 'facebook',  aiName: 'Facebook' },
  { key: 'blog',     label: 'Blog',               icon: 'BL',  requiresVideo: false, platform: 'blog',             captionKey: 'blog',      aiName: 'Blog' },
  { key: 'gbp',      label: 'Google Business',    icon: 'GBP', requiresVideo: false, platform: 'google',           captionKey: 'google',    aiName: 'Google Business' },
]

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function defaultScheduledAt() {
  const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d
}
function fmtTs(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}
function toLocalInput(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function parseAiTime(timeStr) {
  // "11:30 AM", "7:00 PM", "19:00"
  if (!timeStr) return null
  const s = String(timeStr).trim()
  const ampm = s.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)$/)
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/)
  let h, m
  if (ampm) {
    h = Number(ampm[1]); m = Number(ampm[2] || 0)
    const isPm = /pm/i.test(ampm[3])
    if (isPm && h < 12) h += 12
    if (!isPm && h === 12) h = 0
  } else if (h24) {
    h = Number(h24[1]); m = Number(h24[2])
  } else return null
  if (isNaN(h) || isNaN(m)) return null
  return { h, m }
}
function nextOccurrence(dayName, timeStr) {
  const dayIdx = DAY_NAMES.findIndex(d => d.toLowerCase() === String(dayName).toLowerCase())
  const t = parseAiTime(timeStr)
  if (dayIdx < 0 || !t) return null
  const now = new Date()
  const out = new Date(now)
  const diff = (dayIdx - now.getDay() + 7) % 7
  out.setDate(now.getDate() + diff)
  out.setHours(t.h, t.m, 0, 0)
  if (out <= now) out.setDate(out.getDate() + 7)
  return out
}
function topSlotForChannel(scheduleObj, ch) {
  const entry = scheduleObj?.schedule?.find(s => s.platform?.toLowerCase() === ch.aiName.toLowerCase())
  if (!entry || !Array.isArray(entry.slots) || entry.slots.length === 0) return null
  // Rank slots by how soon they fire — pick the nearest upcoming one
  const dated = entry.slots.map(s => ({ s, when: nextOccurrence(s.day, s.time) })).filter(x => x.when)
  if (dated.length === 0) return null
  dated.sort((a, b) => a.when - b.when)
  return dated[0]
}

export default function ChannelsPanelV2({ draftId, files, settings }) {
  const [destinations, setDestinations] = useState({})
  const [captions, setCaptions] = useState({})
  const [firstFileDbId, setFirstFileDbId] = useState(null)
  const [job, setJob] = useState(null)
  const [saving, setSaving] = useState(false)
  const [whenInput, setWhenInput] = useState(toLocalInput(defaultScheduledAt()))
  const [overrides, setOverrides] = useState({}) // { [channelKey]: Date }
  const [scheduling, setScheduling] = useState(false)
  const [schedMsg, setSchedMsg] = useState(null)
  const [schedErr, setSchedErr] = useState(null)
  const [regenKey, setRegenKey] = useState(null) // channel.key while regenerating
  const [regenErr, setRegenErr] = useState(null)

  const [aiSchedule, setAiSchedule] = useState(null)
  const [loadingAi, setLoadingAi] = useState(false)
  const [aiErr, setAiErr] = useState(null)

  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(job => {
      setJob(job || null)
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

  // Load cached AI schedule once (cheap GET)
  useEffect(() => {
    api.loadPostingSchedule().then(s => {
      if (s && !s.error) setAiSchedule(s)
    }).catch(() => {})
  }, [])

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

  const refreshAi = async () => {
    setAiErr(null); setLoadingAi(true)
    try {
      const s = await api.getPostingSchedule()
      if (s?.error) throw new Error(s.error)
      setAiSchedule(s)
    } catch (e) {
      setAiErr(e.message || String(e))
    } finally {
      setLoadingAi(false)
    }
  }

  const applyAllSuggestions = () => {
    const next = { ...overrides }
    for (const ch of CHANNELS) {
      if (!destinations[ch.key]) continue
      const top = topSlotForChannel(aiSchedule, ch)
      if (top) next[ch.key] = top.when
    }
    setOverrides(next)
  }
  const clearAllOverrides = () => setOverrides({})

  const applyOne = (ch) => {
    const top = topSlotForChannel(aiSchedule, ch)
    if (!top) return
    setOverrides(prev => ({ ...prev, [ch.key]: top.when }))
  }
  const clearOne = (chKey) => {
    setOverrides(prev => { const n = { ...prev }; delete n[chKey]; return n })
  }
  const setOverride = (chKey, isoLocal) => {
    const d = new Date(isoLocal)
    if (isNaN(d.getTime())) return
    setOverrides(prev => ({ ...prev, [chKey]: d }))
  }

  const enabledCount = Object.values(destinations).filter(Boolean).length
  const enabledChannels = useMemo(() => CHANNELS.filter(c => destinations[c.key]), [destinations])

  const mergeMeta = typeof window !== 'undefined' ? window._postyMergedVideo : null
  const videoFiles = (files || []).filter(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  const photoFiles = (files || []).filter(f => f.file?.type?.startsWith('image/') || f._mediaType?.startsWith('image/'))
  const hasMerge = !!(mergeMeta?.base64 || mergeMeta?.url || mergeMeta?.blob)
  const hasSingleVideo = !hasMerge && videoFiles.length === 1
  const canProduceVideo = hasMerge || hasSingleVideo
  const canSchedule = files.length > 0 && enabledCount > 0 && !!firstFileDbId

  const buildMedia = async () => {
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
    const p0 = photoFiles[0]
    if (p0?.file) {
      const b = await toBase64(p0.file)
      return { image_base64: b, upload_key: null, media_type: p0.file.type || 'image/jpeg' }
    }
    if (p0?._uploadKey) {
      return { image_base64: null, upload_key: p0._uploadKey, media_type: p0._mediaType || 'image/jpeg' }
    }
    throw new Error('No usable media on this draft')
  }

  // Regenerate the caption for one specific channel. Sends the same
  // voiceover + captions script context the PostTextPanelV2 sends, so
  // the result references what's already on the timeline.
  // opts.withCritique=true includes job.second_opinion so pasted
  // external-AI critique tunes this specific regen.
  const regenChannel = async (ch, opts = {}) => {
    if (!draftId || !firstFileDbId) return
    setRegenErr(null); setRegenKey(ch.key)
    try {
      const f0 = files?.[0]
      const firstSvr = job?.files?.[0]
      const isImg = (f0?.file?.type || f0?._mediaType || firstSvr?.media_type || '').startsWith('image/')
      const uploadUuid = f0?.uploadResult?.uuid || f0?.uploadResult?.id || firstSvr?.upload_uuid || null

      // Script context — same shape PostTextPanelV2 builds.
      const segs = Array.isArray(job?.voiceover_settings?.segments) ? job.voiceover_settings.segments : []
      const voLines = segs
        .filter(s => s?.text?.trim())
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
        .map(s => `[${fmtTs(Number(s.startTime) || 0)}]${s.text.trim()}`)
      const capTimeline = Array.isArray(job?.overlay_settings?.caption_timeline) ? job.overlay_settings.caption_timeline : []
      const capLines = capTimeline
        .filter(c => c?.text?.trim())
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
        .map(c => `[${fmtTs(Number(c.startTime) || 0)}]${c.text.trim()}`)

      const body = {
        filename: f0?.file?.name || f0?._filename || firstSvr?.filename || 'file',
        folder_name: '',
        occasion: '',
        tone: settings?.default_tone || 'warm',
        availability: '',
        platforms: [ch.captionKey],
        upload_id: uploadUuid,
        job_uuid: draftId || null,
        rule_name: true, rule_cta: true, rule_brand: true, rule_seo: true, rule_hashtags: true,
        user_hint: (job?.hint_text) || '',
        voiceover_script: voLines.length ? voLines.join('\n') : undefined,
        captions_script:  capLines.length ? capLines.join('\n') : undefined,
        second_opinion:   opts.withCritique ? (job?.second_opinion || '') : undefined,
      }
      if (isImg && f0?.file) {
        const { toBase64 } = await import('../../lib/crop')
        body.base64 = await toBase64(f0.file)
        body.media_type = f0.file.type || f0._mediaType || 'image/jpeg'
      }
      if (!body.upload_id && !body.base64) {
        setRegenErr(`${ch.label}: no upload ready yet`)
        setRegenKey(null); return
      }

      const caps = {}
      await api.generateStream(body, (partial) => { Object.assign(caps, partial) })

      // Merge into our local captions state + persist via updateJobFile.
      const updated = { ...(captions || {}) }
      if (caps[ch.captionKey] != null) updated[ch.captionKey] = caps[ch.captionKey]
      setCaptions(updated)
      try { await api.updateJobFile(draftId, firstFileDbId, { captions: updated }) }
      catch (e) { console.warn('[channels regen] save failed:', e.message) }
    } catch (e) {
      setRegenErr(`${ch.label}: ${e.message || e}`)
    } finally {
      setRegenKey(null)
    }
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
    const fallback = new Date(whenInput)
    if (isNaN(fallback.getTime())) {
      setSchedErr('Pick a valid fallback date/time.'); return
    }
    const now = new Date()
    setScheduling(true)
    try {
      const media = await buildMedia()
      const isVideoMedia = (media.media_type || '').startsWith('video/')
      const primaryFile = files[0]
      const jobName = primaryFile?.job_name || primaryFile?.file?.name?.replace(/\.[^.]+$/, '') || 'v2 post'
      const skipped = []
      const results = []
      for (const ch of enabledChannels) {
        if (ch.requiresVideo && !isVideoMedia) { skipped.push(`${ch.label} (needs video)`); continue }
        const { caption, title } = captionFor(ch)
        if (!caption && ch.key !== 'gbp') { skipped.push(`${ch.label} (empty caption)`); continue }
        const when = overrides[ch.key] || fallback
        if (when <= now) { skipped.push(`${ch.label} (time is in the past)`); continue }

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

        try {
          const res = await api.schedulePosts([post], when.toISOString())
          const n = res?.scheduled?.length || 1
          results.push(`${ch.label} @ ${when.toLocaleString()}`)
        } catch (e) {
          skipped.push(`${ch.label} (${e.message})`)
        }
      }
      if (results.length === 0) {
        setSchedErr(skipped.length ? `Nothing scheduled — ${skipped.join(', ')}` : 'Nothing scheduled.')
      } else {
        setSchedMsg(`Scheduled ${results.length} post${results.length === 1 ? '' : 's'}: ${results.join(' · ')}${skipped.length ? ` · skipped ${skipped.join(', ')}` : ''}`)
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
          const top = enabled ? topSlotForChannel(aiSchedule, c) : null
          const override = overrides[c.key]
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

              {enabled && (
                <div className="mt-2 pt-2 border-t border-[#e5e5e5]/50 flex items-center gap-2 flex-wrap">
                  {override ? (
                    <>
                      <span className="text-[9px] bg-[#6C5CE7] text-white px-1.5 py-0.5 rounded">
                        {override.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}
                        {override.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <input
                        type="datetime-local"
                        value={toLocalInput(override)}
                        onChange={e => setOverride(c.key, e.target.value)}
                        className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
                      />
                      <button onClick={() => clearOne(c.key)} className="text-[9px] text-muted bg-white border border-[#e5e5e5] rounded py-0.5 px-1.5 cursor-pointer">
                        Use default
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-[9px] text-muted">Uses default time</span>
                      {top && (
                        <button
                          onClick={() => applyOne(c)}
                          className="text-[9px] text-[#6C5CE7] bg-white border border-[#6C5CE7] rounded py-0.5 px-1.5 cursor-pointer"
                          title={top.s.reason || ''}
                        >
                          Use {top.s.day} {top.s.time}
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => regenChannel(c)}
                    disabled={!!regenKey}
                    className="text-[9px] text-[#2D9A5E] bg-white border border-[#2D9A5E] rounded py-0.5 px-1.5 cursor-pointer disabled:opacity-50 ml-auto"
                    title={`Regenerate the ${c.captionKey} caption with the latest voiceover + captions + hints as context`}
                  >{regenKey === c.key ? '↻…' : '↻ Regen'}</button>
                  {job?.second_opinion && (
                    <button
                      onClick={() => regenChannel(c, { withCritique: true })}
                      disabled={!!regenKey}
                      className="text-[9px] text-[#92400e] bg-[#fef3c7] border border-[#d97706]/40 rounded py-0.5 px-1.5 cursor-pointer disabled:opacity-50"
                      title={`Regenerate using the saved critique from Hints:\n\n${String(job.second_opinion).slice(0, 200)}`}
                    >{regenKey === c.key ? '🎯…' : '🎯 w/ critique'}</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-[12px] font-medium flex-1">Best-time suggestions</div>
          {aiSchedule && <span className="text-[9px] text-muted">cached</span>}
          <button
            onClick={refreshAi}
            disabled={loadingAi}
            className="text-[9px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer disabled:opacity-50"
          >{loadingAi ? 'Thinking…' : (aiSchedule ? 'Refresh' : 'Suggest (AI)')}</button>
        </div>
        {aiErr && <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">{aiErr}</div>}
        {!aiSchedule && !aiErr && !loadingAi && (
          <div className="text-[10px] text-muted italic">
            Click "Suggest" to get AI-picked slots based on your business type, location, and any analytics you've pasted into tenant settings.
          </div>
        )}
        {aiSchedule?.posting_frequency && (
          <div className="text-[10px] text-muted italic">{aiSchedule.posting_frequency}</div>
        )}
        {aiSchedule && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={applyAllSuggestions}
              disabled={enabledCount === 0}
              className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer disabled:opacity-50"
            >Apply to all {enabledCount} enabled</button>
            {Object.keys(overrides).length > 0 && (
              <button
                onClick={clearAllOverrides}
                className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-muted rounded bg-white cursor-pointer"
              >Clear overrides</button>
            )}
          </div>
        )}

        <div className="text-[9px] text-muted italic">
          Paste real platform analytics under <b>Settings → Analytics</b> to make these suggestions pull from your actual audience-active hours instead of business-type heuristics.
        </div>
      </div>

      <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
        <div className="text-[12px] font-medium">Default time</div>
        <div className="text-[9px] text-muted">Channels without their own override use this.</div>
        <div className="flex items-center gap-2 flex-wrap">
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
        {regenErr && <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">{regenErr}</div>}
      </div>
    </div>
  )
}

