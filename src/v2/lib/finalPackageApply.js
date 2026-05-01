// Apply pipeline for the final-package flow. Each section is its own
// function so the review modal can apply only the sections the user
// ticked, and a failure in one section doesn't roll back the others.
//
// Phase 4 covers the simple sections (voice, overrides, hooks,
// voiceover, overlays, channels) that just patch existing job fields.
// Phase 5 will add applyMedia (reorder + trim + photo + insert).

import * as api from '../../api'

const KNOWN_CHANNEL_KEYS = ['tiktok', 'instagram', 'facebook', 'youtube', 'google', 'blog']

// Merge a generation_rules patch into the existing object so we don't
// clobber unrelated keys (vocabulary, hashtag mode, etc).
function mergeGenerationRules(current, patch) {
  const cur = (current && typeof current === 'object') ? current : {}
  const next = { ...cur }
  if (patch.voice) next.voice = { ...(cur.voice || {}), ...patch.voice }
  if (patch.overrides) next.overrides = { ...(cur.overrides || {}), ...patch.overrides }
  if (patch.hooks) next.hooks = { ...(cur.hooks || {}), ...patch.hooks }
  if (patch.off_topic !== undefined) next.off_topic = !!patch.off_topic
  return next
}

export async function applyVoice(pkg, draftId, currentJob) {
  if (!pkg.voice) return 'skip'
  const next = mergeGenerationRules(currentJob.generation_rules, {
    voice: pkg.voice,
    off_topic: pkg.voice.off_topic,
  })
  await api.updateJob(draftId, { generation_rules: next })
  return 'ok'
}

export async function applyOverrides(pkg, draftId, currentJob) {
  if (!pkg.overrides) return 'skip'
  const next = mergeGenerationRules(currentJob.generation_rules, { overrides: pkg.overrides })
  await api.updateJob(draftId, { generation_rules: next })
  return 'ok'
}

export async function applyHooks(pkg, draftId, currentJob) {
  if (!pkg.hooks) return 'skip'
  const cur = currentJob.generation_rules || {}
  const curHooks = cur.hooks || {}
  const text = pkg.hooks.selected
  const nextHooks = { ...curHooks, selected: typeof text === 'string' ? { text, from: 'final-package' } : curHooks.selected }
  const next = { ...cur, hooks: nextHooks }
  await api.updateJob(draftId, { generation_rules: next })
  return 'ok'
}

// Voiceover apply: try to preserve existing audio keys when text+timing
// match an existing segment. New/changed segments get audioKey=null —
// the user re-generates TTS through the panel afterward. Hard
// destruction of every segment's audio is unfriendly; preserving when
// the text is byte-identical lets a small voice tweak skip TTS.
export async function applyVoiceover(pkg, draftId, currentJob) {
  if (!Array.isArray(pkg.voiceover)) return 'skip'
  const curVo = currentJob.voiceover_settings || {}
  const curSegs = Array.isArray(curVo.segments) ? curVo.segments : []
  const curById = new Map(curSegs.map(s => [s?.id, s]))
  const curByText = new Map(curSegs.map(s => [String(s?.text || '').trim(), s]).filter(([k]) => k))

  const nextSegs = pkg.voiceover.map(s => {
    const matchById = s.id ? curById.get(s.id) : null
    const matchByText = !matchById ? curByText.get(String(s.text || '').trim()) : null
    const match = matchById || matchByText
    return {
      id: s.id || `vo-${Math.random().toString(36).slice(2, 8)}`,
      text: s.text,
      startTime: Number(s.start) || 0,
      duration: Math.max(0.1, Number(s.end) - Number(s.start)),
      audioKey: match?.audioKey || null,
      ...(s.showCaption === false ? { hideCaption: true } : {}),
    }
  })

  // Preserve __primary__ and any pre-existing job-level toggles.
  const primary = curSegs.find(s => s?.id === '__primary__')
  const finalSegs = primary ? [primary, ...nextSegs] : nextSegs
  await api.updateJob(draftId, {
    voiceover_settings: { ...curVo, segments: finalSegs },
  })
  return 'ok'
}

export async function applyOverlays(pkg, draftId, currentJob) {
  if (!pkg.overlays) return 'skip'
  const cur = currentJob.overlay_settings || {}
  const next = { ...cur }
  if (pkg.overlays.opening) {
    next.openingText = pkg.overlays.opening.text || ''
    if (pkg.overlays.opening.duration != null) next.openingDuration = Number(pkg.overlays.opening.duration)
  }
  if (pkg.overlays.middle) {
    next.middleText = pkg.overlays.middle.text || ''
    if (pkg.overlays.middle.duration != null) next.middleDuration = Number(pkg.overlays.middle.duration)
    if (pkg.overlays.middle.startTime != null) next.middleStartTime = Number(pkg.overlays.middle.startTime)
  }
  if (pkg.overlays.closing) {
    next.closingText = pkg.overlays.closing.text || ''
    if (pkg.overlays.closing.duration != null) next.closingDuration = Number(pkg.overlays.closing.duration)
  }
  await api.updateJob(draftId, { overlay_settings: next })
  return 'ok'
}

// Channels apply: writes into job_files[0].captions[platform] and
// flips post_destinations[platform]=true for any channel the package
// touched. Captions are normalized to { text, title?, hashtags? } —
// callers tolerate either string or object so this is safe.
export async function applyChannels(pkg, draftId, firstFileDbId, currentJob) {
  if (!pkg.channels || !firstFileDbId) return 'skip'
  const f0 = currentJob.files?.[0] || {}
  const curCaps = (f0.captions && typeof f0.captions === 'object') ? f0.captions : {}
  const curDest = (f0.post_destinations && typeof f0.post_destinations === 'object') ? f0.post_destinations : {}
  const nextCaps = { ...curCaps }
  const nextDest = { ...curDest }
  for (const k of KNOWN_CHANNEL_KEYS) {
    const v = pkg.channels[k]
    if (!v || typeof v !== 'object') continue
    const existing = (typeof curCaps[k] === 'object' && curCaps[k]) ? curCaps[k] : {}
    const merged = { ...existing }
    if (typeof v.caption === 'string') merged.text = v.caption
    if (typeof v.title === 'string') merged.title = v.title
    if (Array.isArray(v.hashtags)) merged.hashtags = v.hashtags
    nextCaps[k] = merged
    // Only flip on — don't disable any destination the user already turned off.
    if (!nextDest[k]) nextDest[k] = true
  }
  await api.updateJobFile(draftId, firstFileDbId, {
    captions: nextCaps,
    post_destinations: nextDest,
  })
  return 'ok'
}

// Compute simple field-level diffs for the review UI. Returns a list
// of { label, before, after } per section. Phase 6 will rewrite this
// for richer media diff; Phase 4 just needs counts + per-field strings.
export function computeDiffs(pkg, currentJob) {
  const out = {}
  const cur = currentJob || {}
  const gr = cur.generation_rules || {}
  const f0 = cur.files?.[0] || {}

  if (pkg.voice) {
    const cv = gr.voice || {}
    out.voice = []
    for (const k of ['tone', 'pov', 'marketing_intensity']) {
      if (pkg.voice[k] !== undefined && (cv[k] || '') !== (pkg.voice[k] || '')) {
        out.voice.push({ label: `voice.${k}`, before: cv[k] || '(unset)', after: pkg.voice[k] })
      }
    }
    if (pkg.voice.off_topic !== undefined && !!gr.off_topic !== !!pkg.voice.off_topic) {
      out.voice.push({ label: 'voice.off_topic', before: !!gr.off_topic, after: !!pkg.voice.off_topic })
    }
  }
  if (pkg.overrides) {
    const co = gr.overrides || {}
    out.overrides = []
    for (const k of ['key_insights', 'audience_notes', 'posting_style', 'seo_keywords', 'default_hashtags_all']) {
      if (pkg.overrides[k] !== undefined && (co[k] || '') !== (pkg.overrides[k] || '')) {
        out.overrides.push({ label: `overrides.${k}`, before: trim(co[k]), after: trim(pkg.overrides[k]) })
      }
    }
  }
  if (pkg.hooks) {
    const cur = (gr.hooks?.selected?.text) || gr.hooks?.selected || ''
    if (pkg.hooks.selected !== undefined && cur !== pkg.hooks.selected) {
      out.hooks = [{ label: 'hooks.selected', before: trim(cur), after: trim(pkg.hooks.selected) }]
    }
  }
  if (Array.isArray(pkg.voiceover)) {
    const curSegs = (cur.voiceover_settings?.segments || []).filter(s => s?.id !== '__primary__')
    out.voiceover = [{
      label: 'voiceover segments',
      before: `${curSegs.length} segment(s)`,
      after: `${pkg.voiceover.length} segment(s)`,
    }]
    const hideChanges = pkg.voiceover.filter((s, i) => {
      const cs = curSegs[i]
      const curHidden = !!cs?.hideCaption
      const newHidden = s.showCaption === false
      return curHidden !== newHidden
    })
    if (hideChanges.length > 0) {
      out.voiceover.push({ label: 'caption visibility', before: '', after: `${hideChanges.length} segment(s) toggled` })
    }
  }
  if (pkg.overlays) {
    const co = cur.overlay_settings || {}
    out.overlays = []
    for (const slot of ['opening', 'middle', 'closing']) {
      if (!pkg.overlays[slot]) continue
      const newText = pkg.overlays[slot].text || ''
      const curText = co[`${slot}Text`] || ''
      if (newText !== curText) out.overlays.push({ label: `overlays.${slot}.text`, before: trim(curText), after: trim(newText) })
      const newDur = pkg.overlays[slot].duration
      const curDur = co[`${slot}Duration`]
      if (newDur != null && Number(curDur) !== Number(newDur)) out.overlays.push({ label: `overlays.${slot}.duration`, before: curDur ?? '(default)', after: newDur })
    }
  }
  if (pkg.channels) {
    const cc = (typeof f0.captions === 'object' && f0.captions) || {}
    out.channels = []
    for (const k of KNOWN_CHANNEL_KEYS) {
      const v = pkg.channels[k]
      if (!v || typeof v !== 'object') continue
      const existing = (typeof cc[k] === 'object' && cc[k]) ? cc[k] : (typeof cc[k] === 'string' ? { text: cc[k] } : {})
      if (typeof v.caption === 'string' && (existing.text || '') !== v.caption) {
        out.channels.push({ label: `${k}.caption`, before: trim(existing.text), after: trim(v.caption) })
      }
      if (typeof v.title === 'string' && (existing.title || '') !== v.title) {
        out.channels.push({ label: `${k}.title`, before: trim(existing.title), after: trim(v.title) })
      }
      if (Array.isArray(v.hashtags)) {
        const before = Array.isArray(existing.hashtags) ? existing.hashtags.join(' ') : ''
        const after = v.hashtags.join(' ')
        if (before !== after) out.channels.push({ label: `${k}.hashtags`, before: trim(before), after: trim(after) })
      }
    }
  }
  return out
}

function trim(v, n = 80) {
  if (v == null) return '(empty)'
  const s = String(v)
  return s.length > n ? s.slice(0, n) + '…' : s
}
