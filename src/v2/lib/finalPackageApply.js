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

// Voiceover apply: the panel models a synthetic __primary__ segment
// for the at-t=0 voice (panel labels it "#1 / Primary"). Any package
// segment that starts at t=0 maps onto __primary__ — otherwise it
// shows up as #2 because we'd preserve the old primary AND prepend
// the new segment. Other segments become #2, #3, etc. ordered by
// startTime.
//
// We try to preserve audioKey when text+timing match an existing
// segment so a small voice tweak doesn't force a full TTS regen.
export async function applyVoiceover(pkg, draftId, currentJob) {
  if (!Array.isArray(pkg.voiceover)) return 'skip'
  const curVo = currentJob.voiceover_settings || {}
  const curSegs = Array.isArray(curVo.segments) ? curVo.segments : []
  const curById = new Map(curSegs.map(s => [s?.id, s]))
  const curByText = new Map(curSegs.map(s => [String(s?.text || '').trim(), s]).filter(([k]) => k))
  const existingPrimary = curSegs.find(s => s?.id === '__primary__') || null

  const sortedPkg = [...pkg.voiceover].sort(
    (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0)
  )
  // The first segment at (or near) t=0 is the primary. Everything
  // else is a timed overlay segment.
  const firstAtZero = sortedPkg[0] && Number(sortedPkg[0].start) < 0.1 ? sortedPkg[0] : null
  const timedPkg = firstAtZero ? sortedPkg.slice(1) : sortedPkg

  let primarySeg = null
  if (firstAtZero) {
    const samePrimaryText = existingPrimary
      && String(existingPrimary.text || '').trim() === String(firstAtZero.text || '').trim()
    primarySeg = {
      id: '__primary__',
      text: firstAtZero.text,
      startTime: 0,
      duration: Math.max(0.1, Number(firstAtZero.end) - Number(firstAtZero.start)),
      audioKey: samePrimaryText ? (existingPrimary.audioKey || null) : null,
      ...(firstAtZero.showCaption === false ? { hideCaption: true } : {}),
    }
  } else if (existingPrimary) {
    // Package didn't touch t=0 — preserve the user's existing primary.
    primarySeg = existingPrimary
  }

  const nextTimed = timedPkg.map(s => {
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

  const finalSegs = primarySeg ? [primarySeg, ...nextTimed] : nextTimed
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

// Apply media changes: reorder + per-clip trim/photo/insert mutations
// + deletes. Order of operations matters:
//   1. Detach inserts that are about to move to a new host (or be removed)
//      — we set insert_into_file_id=null first so the host reorder
//      doesn't temporarily reference the wrong host.
//   2. Per-clip mutations (trim, photo settings).
//   3. Re-attach inserts to their (possibly new) host.
//   4. Update file_order to match the package's order.
//   5. Delete files marked for removal (those in current files but
//      not present in pkg.media).
// Failures abort the remaining steps and surface the first error.
// The caller refreshes the job after to pick up final state.
export async function applyMedia(pkg, draftId, currentJob, removed) {
  if (!Array.isArray(pkg.media) || pkg.media.length === 0) return 'skip'
  if (!draftId) throw new Error('draftId required')
  const files = currentJob.files || []
  const fileById = new Map(files.map(f => [Number(f.id), f]))

  // 1. Detach inserts up front. Any current insert relationship that
  //    won't survive (host changes, this clip becomes a host, this
  //    clip is removed) needs the link cleared first.
  const detachOps = []
  for (const f of files) {
    if (f.insert_into_file_id == null) continue
    const stillExists = pkg.media.some(m => m._resolvedDbId === Number(f.id))
    const wantedHost = pkg.media.find(m => m._resolvedDbId === Number(f.id))?._resolvedInsertInto
    if (!stillExists || wantedHost !== Number(f.insert_into_file_id)) {
      detachOps.push(api.updateJobFile(draftId, f.id, {
        insert_into_file_id: null,
        insert_at_sec: 0,
      }))
    }
  }
  await Promise.all(detachOps)

  // 2. Per-clip mutations: trim, photo settings, speed unchanged.
  for (let i = 0; i < pkg.media.length; i++) {
    const m = pkg.media[i]
    const dbId = m._resolvedDbId
    if (!dbId) continue
    const patch = {}
    if (Array.isArray(m.trim) && m.trim.length === 2) {
      patch.trim_start = Number(m.trim[0])
      patch.trim_end = Number(m.trim[1])
    }
    if (m.photo && typeof m.photo === 'object') {
      if (m.photo.motion !== undefined) patch.photo_to_video_motion = m.photo.motion
      if (m.photo.zoom !== undefined) patch.photo_to_video_zoom = Number(m.photo.zoom)
      if (m.photo.rotate !== undefined) patch.photo_to_video_rotate = Number(m.photo.rotate)
      if (m.photo.offsetX !== undefined) patch.photo_to_video_offset_x = Number(m.photo.offsetX)
      if (m.photo.offsetY !== undefined) patch.photo_to_video_offset_y = Number(m.photo.offsetY)
      if (m.photo.duration !== undefined) {
        // Photo display duration is stored as trim_end on photo clips
        // (the panel uses trim_end as the photo display seconds).
        patch.trim_end = Number(m.photo.duration)
      }
    }
    if (Object.keys(patch).length > 0) {
      await api.updateJobFile(draftId, dbId, patch)
    }
  }

  // 3. Re-attach inserts.
  for (const m of pkg.media) {
    if (m._resolvedInsertInto == null) continue
    await api.updateJobFile(draftId, m._resolvedDbId, {
      insert_into_file_id: m._resolvedInsertInto,
      insert_at_sec: Number(m.insertAt) >= 0 ? Number(m.insertAt) : 0,
    })
  }

  // 4. file_order: walk pkg.media in order, give each clip a fresh
  //    sequential index. Clips removed below stay outside the order
  //    so they don't conflict with the new positions.
  await Promise.all(pkg.media.map((m, idx) =>
    api.updateJobFile(draftId, m._resolvedDbId, { file_order: idx })
  ))

  // 5. Deletes — anything in `removed` that the user didn't omit by
  //    accident. The normalize step computed this list; we trust it
  //    rather than re-deriving here so the modal's diff matches what
  //    actually happens.
  if (Array.isArray(removed) && removed.length > 0) {
    for (const f of removed) {
      if (f._dbFileId == null) continue
      try {
        await api.deleteJobFile(draftId, f._dbFileId)
      } catch (e) {
        // Surface the failure but keep going — partial removal is
        // recoverable; aborting halfway leaves a worse state.
        console.warn('[applyMedia] delete failed for', f._dbFileId, e?.message)
      }
    }
  }

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
  if (Array.isArray(pkg.media)) {
    const curFiles = cur.files || []
    const curOrder = curFiles.map(f => f.id).filter(Boolean)
    const newOrder = pkg.media.map(m => m._resolvedDbId).filter(Boolean)
    out.media = []
    if (curOrder.join(',') !== newOrder.join(',')) {
      out.media.push({
        label: 'order',
        before: curOrder.map(id => `clip-${id}`).join(', ') || '(empty)',
        after: newOrder.map(id => `clip-${id}`).join(', ') || '(empty)',
      })
    }
    for (const m of pkg.media) {
      const f = curFiles.find(x => Number(x.id) === Number(m._resolvedDbId))
      if (!f) continue
      if (Array.isArray(m.trim) && m.trim.length === 2) {
        const ts = Number(f.trim_start) || 0
        const te = f.trim_end != null ? Number(f.trim_end) : null
        if (ts !== Number(m.trim[0]) || te !== Number(m.trim[1])) {
          out.media.push({ label: `clip-${m._resolvedDbId}.trim`, before: `${ts}–${te ?? '?'}`, after: `${m.trim[0]}–${m.trim[1]}` })
        }
      }
      if (m.photo && typeof m.photo === 'object') {
        const fields = [
          ['motion', f.photo_to_video_motion, m.photo.motion],
          ['zoom', f.photo_to_video_zoom, m.photo.zoom],
          ['rotate', f.photo_to_video_rotate, m.photo.rotate],
          ['offsetX', f.photo_to_video_offset_x, m.photo.offsetX],
          ['offsetY', f.photo_to_video_offset_y, m.photo.offsetY],
        ]
        for (const [k, before, after] of fields) {
          if (after !== undefined && String(before ?? '') !== String(after)) {
            out.media.push({ label: `clip-${m._resolvedDbId}.photo.${k}`, before: before ?? '(unset)', after })
          }
        }
        if (m.photo.duration !== undefined) {
          const curDur = f.trim_end != null ? Number(f.trim_end) : null
          if (curDur !== Number(m.photo.duration)) {
            out.media.push({ label: `clip-${m._resolvedDbId}.photo.duration`, before: curDur ?? '(default)', after: m.photo.duration })
          }
        }
      }
      if (m._resolvedInsertInto != null) {
        const curHost = f.insert_into_file_id != null ? Number(f.insert_into_file_id) : null
        if (curHost !== m._resolvedInsertInto) {
          out.media.push({ label: `clip-${m._resolvedDbId}.insertInto`, before: curHost ? `clip-${curHost}` : '(none)', after: `clip-${m._resolvedInsertInto}` })
        }
      }
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

// After apply, fetch the job fresh and compare each section against
// what the package said should land. Returns { ok, mismatches[] }.
// Each mismatch is { section, label, expected, actual } for the popup.
// "ok" reports from applyXxx aren't trustworthy — the API call may
// have 200'd but the BE might have dropped a field, or our local
// patch didn't include all the columns we expected. Verifying against
// the fresh DB snapshot is the only reliable confirmation.
export async function verifyApply(pkg, draftId, removed) {
  const mismatches = []
  let job = null
  try {
    job = await api.getJob(draftId)
  } catch (e) {
    return { ok: false, mismatches: [{ section: 'fetch', label: 'reload job', expected: 'job data', actual: `error: ${e?.message || e}` }] }
  }
  if (!job) return { ok: false, mismatches: [{ section: 'fetch', label: 'reload job', expected: 'job data', actual: 'null' }] }

  const gr = job.generation_rules || {}

  if (pkg.voice) {
    for (const k of ['tone', 'pov', 'marketing_intensity']) {
      if (pkg.voice[k] !== undefined && (gr.voice?.[k] || '') !== (pkg.voice[k] || '')) {
        mismatches.push({ section: 'voice', label: `voice.${k}`, expected: pkg.voice[k], actual: gr.voice?.[k] || '(unset)' })
      }
    }
    if (pkg.voice.off_topic !== undefined && !!gr.off_topic !== !!pkg.voice.off_topic) {
      mismatches.push({ section: 'voice', label: 'voice.off_topic', expected: !!pkg.voice.off_topic, actual: !!gr.off_topic })
    }
  }
  if (pkg.overrides) {
    const co = gr.overrides || {}
    for (const k of Object.keys(pkg.overrides)) {
      if ((co[k] || '') !== (pkg.overrides[k] || '')) {
        mismatches.push({ section: 'overrides', label: `overrides.${k}`, expected: trim(pkg.overrides[k]), actual: trim(co[k]) })
      }
    }
  }
  if (pkg.hooks?.selected !== undefined) {
    const cur = (gr.hooks?.selected?.text) || gr.hooks?.selected || ''
    if (cur !== pkg.hooks.selected) {
      mismatches.push({ section: 'hooks', label: 'hooks.selected', expected: trim(pkg.hooks.selected), actual: trim(cur) })
    }
  }
  if (Array.isArray(pkg.voiceover)) {
    const segs = (job.voiceover_settings?.segments || [])
    // Match by text — id can drift if applyVoiceover assigned a fresh id.
    for (const expected of pkg.voiceover) {
      const wanted = String(expected.text || '').trim()
      if (!wanted) continue
      const found = segs.find(s => String(s.text || '').trim() === wanted)
      if (!found) {
        mismatches.push({ section: 'voiceover', label: `vo segment "${trim(wanted, 40)}"`, expected: 'present', actual: 'missing' })
      } else if (expected.showCaption === false && !found.hideCaption) {
        mismatches.push({ section: 'voiceover', label: `vo "${trim(wanted, 30)}".hideCaption`, expected: true, actual: !!found.hideCaption })
      }
    }
  }
  if (pkg.overlays) {
    const co = job.overlay_settings || {}
    for (const slot of ['opening', 'middle', 'closing']) {
      if (!pkg.overlays[slot]) continue
      const expectedText = pkg.overlays[slot].text || ''
      const actualText = co[`${slot}Text`] || ''
      if (expectedText !== actualText) {
        mismatches.push({ section: 'overlays', label: `overlays.${slot}.text`, expected: trim(expectedText), actual: trim(actualText) })
      }
    }
  }
  if (pkg.channels) {
    const f0 = job.files?.[0] || {}
    const cc = (typeof f0.captions === 'object' && f0.captions) || {}
    for (const k of Object.keys(pkg.channels)) {
      const expected = pkg.channels[k]
      if (!expected || typeof expected !== 'object') continue
      const existing = (typeof cc[k] === 'object' && cc[k]) ? cc[k] : (typeof cc[k] === 'string' ? { text: cc[k] } : {})
      if (typeof expected.caption === 'string' && (existing.text || '') !== expected.caption) {
        mismatches.push({ section: 'channels', label: `${k}.caption`, expected: trim(expected.caption), actual: trim(existing.text) })
      }
    }
  }
  if (Array.isArray(pkg.media)) {
    const curFiles = job.files || []
    const expectedOrder = pkg.media.map(m => Number(m._resolvedDbId)).filter(Boolean)
    // Sort current files by file_order to compare against pkg.media order.
    const sortedCur = curFiles.slice().sort((a, b) => (Number(a.file_order) || 0) - (Number(b.file_order) || 0))
    const actualOrder = sortedCur.map(f => Number(f.id))
    // Only verify the ordered slice that matches package length — extras
    // beyond pkg.media should have been removed.
    if (expectedOrder.join(',') !== actualOrder.slice(0, expectedOrder.length).join(',')) {
      mismatches.push({ section: 'media', label: 'order', expected: expectedOrder.map(id => `clip-${id}`).join(', '), actual: actualOrder.map(id => `clip-${id}`).join(', ') })
    }
    if (Array.isArray(removed)) {
      for (const r of removed) {
        if (r._dbFileId == null) continue
        if (curFiles.some(f => Number(f.id) === Number(r._dbFileId))) {
          mismatches.push({ section: 'media', label: `clip-${r._dbFileId}`, expected: 'deleted', actual: 'still present' })
        }
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches, job }
}

// Recommend per-slot overlay font sizes + a default-caption-style
// base_font_size based on text length. Sizes are in pixels for the
// 1080×1920 export canvas, matching the existing slider range.
// Shorter strings get bigger fonts; the LR thresholds are tuned to
// what looks readable in the editor's first-2s preview.
export function recommendFontSizes(pkg) {
  const out = { overlays: {}, captionBase: null }
  const sizeFor = (text) => {
    const len = String(text || '').length
    if (len === 0) return null
    if (len <= 8) return 110
    if (len <= 20) return 90
    if (len <= 40) return 72
    if (len <= 70) return 58
    return 50
  }
  if (pkg.overlays) {
    for (const slot of ['opening', 'middle', 'closing']) {
      const t = pkg.overlays[slot]?.text
      const sz = sizeFor(t)
      if (sz != null) out.overlays[slot] = sz
    }
  }
  if (Array.isArray(pkg.voiceover) && pkg.voiceover.length > 0) {
    // Word-timing captions show ~1–3 words at a time, so we pick from
    // the AVERAGE word count of the longest segment line. ~12 words/
    // segment is the sweet spot for ~1.6s segments. Anything denser
    // gets a smaller font so the line doesn't wrap on a phone.
    const wordCounts = pkg.voiceover.map(s => String(s.text || '').trim().split(/\s+/).length)
    const maxWords = Math.max(...wordCounts, 0)
    if (maxWords > 0) {
      out.captionBase = maxWords <= 5 ? 95 : maxWords <= 9 ? 80 : maxWords <= 14 ? 68 : 56
    }
  }
  return out
}

// Resolution order for font sizes / colors / Y placement:
//   1. Tenant default (tenantSettings.default_overlay_style)
//   2. Text-length-based recommender (recommendFontSizes)
//   3. Existing job value preserved when neither above applies
// Tenant beats recommender — the user explicitly asked for "use these
// when the producer's final package is applied". Recommender only
// fills in slots the tenant hasn't customized.
export async function applyRecommendedFontSizes(pkg, draftId, currentJob, tenantSettings) {
  const rec = recommendFontSizes(pkg)
  const tenantDef = (tenantSettings?.default_overlay_style && typeof tenantSettings.default_overlay_style === 'object')
    ? tenantSettings.default_overlay_style : {}
  const pick = (tenantKey, recKey) => {
    const tv = tenantDef[tenantKey]
    if (tv != null && tv !== '') return Number(tv)
    return rec.overlays?.[recKey] ?? null
  }

  const cur = currentJob.overlay_settings || {}
  const next = { ...cur }
  let touchedOverlays = false

  // Per-slot font sizes
  const open = pick('openingFontSize', 'opening')
  const mid  = pick('middleFontSize',  'middle')
  const clos = pick('closingFontSize', 'closing')
  if (open != null && pkg.overlays?.opening) { next.openingFontSize = open; touchedOverlays = true }
  if (mid  != null && pkg.overlays?.middle)  { next.middleFontSize  = mid;  touchedOverlays = true }
  if (clos != null && pkg.overlays?.closing) { next.closingFontSize = clos; touchedOverlays = true }

  // Tenant-level color/outline/family/Y placement when set — copied
  // even when the package didn't touch overlays, since these are
  // brand-level invariants the user asked us to apply on every
  // final-package run.
  if (tenantDef.fontColor) {
    next.fontColor = tenantDef.fontColor
    next.openingFontColor = tenantDef.fontColor
    next.middleFontColor = tenantDef.fontColor
    next.closingFontColor = tenantDef.fontColor
    touchedOverlays = true
  }
  if (tenantDef.fontFamily)   { next.fontFamily = tenantDef.fontFamily; touchedOverlays = true }
  if (tenantDef.fontOutline)  { next.fontOutline = tenantDef.fontOutline; touchedOverlays = true }
  if (tenantDef.outlineWidth != null) { next.outlineWidth = Number(tenantDef.outlineWidth); touchedOverlays = true }
  if (tenantDef.openingYPct != null) { next.openingYPct = Number(tenantDef.openingYPct); touchedOverlays = true }
  if (tenantDef.middleYPct != null)  { next.middleYPct  = Number(tenantDef.middleYPct);  touchedOverlays = true }
  if (tenantDef.closingYPct != null) { next.closingYPct = Number(tenantDef.closingYPct); touchedOverlays = true }

  const promises = []
  if (touchedOverlays) {
    promises.push(api.updateJob(draftId, { overlay_settings: next }))
  }

  // Caption (word-timing) styling. Tenant captionFontSize beats the
  // text-length recommender. Tenant captionYPct sets layout vertical
  // placement.
  const captionSize = (tenantDef.captionFontSize != null && tenantDef.captionFontSize !== '')
    ? Number(tenantDef.captionFontSize)
    : rec.captionBase
  if (captionSize != null) {
    const body = { base_font_size: captionSize }
    if (tenantDef.captionYPct != null) body.vertical_position = Number(tenantDef.captionYPct)
    promises.push(
      api.cascadeJobDefaultCaptionStyle(draftId, body)
        .catch(e => { console.warn('[font cascade] failed:', e?.message); throw e })
    )
  }

  await Promise.all(promises)
  return { ...rec, tenantApplied: Object.keys(tenantDef).length > 0 }
}

// Generate TTS for any VO segment that lacks an audio key. Sequential
// (ElevenLabs rate-limits + we want predictable progress reporting).
// Voice resolution order:
//   1. seg.voiceId (per-segment override)
//   2. voiceover_settings.voiceId (job default)
//   3. tenantSettings.elevenlabs_voice_id (tenant default — set
//      per-tenant in Settings; e.g. Poppy & Thyme = "Layla - excited
//      (Cloned)")
// If the job has no voiceId but a tenant default exists, we PROMOTE
// that default into voiceover_settings.voiceId before generating so
// the same voice is used on subsequent regenerations and the tab UI
// reflects the actual choice instead of an empty dropdown.
export async function generateMissingVoiceovers(draftId, currentJob, tenantSettings, onProgress) {
  const vo = currentJob.voiceover_settings || {}
  const segs = Array.isArray(vo.segments) ? vo.segments : []
  const tenantDefaultVoice = tenantSettings?.elevenlabs_voice_id || null
  const fallbackVoice = vo.voiceId || tenantDefaultVoice
  const needsAudio = segs.filter(s => s && s.text && !s.audioKey)
  if (needsAudio.length === 0) return { generated: 0, failed: 0, skipped: 0 }
  if (!fallbackVoice) {
    return {
      generated: 0,
      failed: 0,
      skipped: needsAudio.length,
      error: 'No voice configured — set a default voice in the tenant Settings (Voice section) first.',
    }
  }
  // Promote tenant default into job-level voiceId so the UI reflects
  // it next time the user opens the Voiceover tab.
  let promotedVoiceId = vo.voiceId || null
  if (!vo.voiceId && tenantDefaultVoice) {
    promotedVoiceId = tenantDefaultVoice
  }

  let generated = 0
  let failed = 0
  const updatedSegs = segs.slice()

  for (let i = 0; i < needsAudio.length; i++) {
    const seg = needsAudio[i]
    onProgress?.(`Generating voice ${i + 1}/${needsAudio.length}…`)
    try {
      const speed = Number(seg.speed) || 1.0
      const r = await api.textToSpeech(seg.text.trim(), seg.voiceId || fallbackVoice, {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
        speed,
      })
      if (r?.error) throw new Error(r.error)
      const saveRes = await api.saveVoiceoverSegment(
        r.audio_base64, draftId, seg.id, r.media_type || 'audio/mpeg', r.word_timings
      )
      const audioKey = saveRes?.audio_key || null
      if (!audioKey) throw new Error('Server returned no audio_key')
      const idx = updatedSegs.findIndex(s => s.id === seg.id)
      if (idx >= 0) updatedSegs[idx] = { ...updatedSegs[idx], audioKey, voiceId: seg.voiceId || fallbackVoice }
      generated += 1
    } catch (e) {
      console.error('[generateMissing] failed for', seg.id, e?.message)
      failed += 1
    }
  }

  // Persist the new audio keys + the promoted voiceId back into voiceover_settings.
  if (generated > 0 || promotedVoiceId !== vo.voiceId) {
    await api.updateJob(draftId, {
      voiceover_settings: { ...vo, voiceId: promotedVoiceId, segments: updatedSegs },
    })
  }

  return { generated, failed, skipped: 0, voiceUsed: fallbackVoice }
}
