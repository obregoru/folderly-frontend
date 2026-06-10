// Final-package: parse + validate + normalize the strict JSON block the
// producer chat emits when the user asks for a "final package". Three
// concerns kept separate:
//
//   parseFinalPackage(text)     → extract the fenced ```final-package
//                                  block from a chat reply
//   validateFinalPackage(pkg)   → shape/range/type checks on the parsed
//                                  object (no DB context needed)
//   normalizeFinalPackage(pkg,  → resolve clip-<id> refs against current
//                       files)   files; compute the removed list; reject
//                                  unresolvable refs
//
// The validator is dep-free on purpose — adding zod here would mean
// shipping ~13kb to every editor session for one feature. The schema
// is small enough that hand-rolling earns clearer error messages.

export const FINAL_PACKAGE_VERSION = 1

const KNOWN_SECTIONS = new Set([
  'voice', 'overrides', 'hooks', 'voiceover', 'overlays', 'media', 'channels', 'version',
])

const KNOWN_CHANNELS = new Set([
  'tiktok', 'instagram', 'facebook', 'youtube', 'google', 'blog',
])

const VALID_MOTIONS = new Set([
  'zoom-in', 'zoom-out', 'pan-lr', 'pan-rl',
  'pan-lr-zoom-in', 'pan-lr-zoom-out',
  'pan-rl-zoom-in', 'pan-rl-zoom-out',
  'static',
])

const VALID_TONES = new Set([
  'warm-conversational', 'professional', 'playful', 'bold', 'inspirational',
  'educational', 'humorous', 'urgent', 'authoritative', '',
])

const VALID_POVS = new Set(['first-person', 'second-person', 'third-person', ''])
const VALID_MARKETING = new Set(['low', 'medium', 'high', ''])

// Pull the fenced ```final-package code block out of a chat reply. The
// producer prompt instructs the AI to wrap the JSON in this exact fence
// so the FE can find it deterministically. Returns the parsed object or
// null when no block is present (or when JSON.parse throws).
export function parseFinalPackage(text) {
  if (typeof text !== 'string' || !text) return null
  // Try the strict fence first — that's what the producer is
  // instructed to emit. When it complies (90%+ of normal chat
  // turns), we land here and skip the fallbacks.
  const strictRe = /```\s*final-package\s*\n([\s\S]*?)```/i
  const strictMatch = text.match(strictRe)
  if (strictMatch) {
    const body = strictMatch[1].trim()
    if (body) {
      try { return coerceFinalPackage(JSON.parse(body)) } catch { /* fall through */ }
    }
  }
  // Fallback: producer drifted to ```json or bare ``` (happens
  // mid-conversation despite the system prompt — the "Lock in"
  // conversion turn especially trips this). We're conservative:
  // only accept a JSON fence whose top-level keys look like our
  // schema — otherwise we'd pick up unrelated JSON the producer
  // dumped earlier in the reply (e.g. a JSON example it showed
  // the operator) and confuse the review modal.
  const fallbackRes = [
    /```\s*json\s*\n([\s\S]*?)```/i,
    /```\s*\n(\{[\s\S]*?\})\s*```/,
  ]
  for (const re of fallbackRes) {
    const m = text.match(re)
    if (!m) continue
    const body = m[1].trim()
    if (!body) continue
    let parsed
    try { parsed = JSON.parse(body) } catch { continue }
    if (looksLikeFinalPackage(parsed)) return coerceFinalPackage(parsed)
  }
  return null
}

// Lightweight discriminator — returns true when the parsed object
// has at least one of our known top-level keys. validateFinalPackage
// downstream will reject anything that's structurally wrong, so we
// can be permissive here without false-positives.
function looksLikeFinalPackage(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const RECOGNIZED = ['voice', 'overrides', 'hooks', 'voiceover', 'overlays', 'media', 'channels']
  return RECOGNIZED.some(k => k in obj)
}

// Coerce common AI drift patterns into the canonical schema shape.
// Run BEFORE validation. Keeps us from rejecting fundamentally-
// correct packages over predictable formatting variance:
//
//   - overlays as array of {position, text, ...} (LLM-natural)
//     → object keyed by position name ("opening"/"middle"/"closing")
//   - voiceover[].start / .end as "M:SS"/"M:SS.s"/"SS.s" strings
//     → numeric seconds
//   - channels with youtube_shorts / google_business keys
//     → youtube / google
//   - channel hashtags as space-separated string → array
//
// Mutates a deep clone of the input so callers keep their original.
export function coerceFinalPackage(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return pkg
  let out
  try { out = JSON.parse(JSON.stringify(pkg)) } catch { return pkg }

  // ── overlays: array → object keyed by position ──
  if (Array.isArray(out.overlays)) {
    const obj = {}
    for (const item of out.overlays) {
      if (!item || typeof item !== 'object') continue
      // Position names from LLM drift — normalize lowercase, handle
      // snake_case + camelCase + space variants for the two new slots.
      const posRaw = String(item.position || item.slot || '').toLowerCase().replace(/[\s_-]/g, '')
      let pos
      if (posRaw === 'opening' || posRaw === 'open') pos = 'opening'
      else if (posRaw === 'earlymiddle' || posRaw === 'middle1' || posRaw === 'firstmid' || posRaw === 'earlymid') pos = 'earlyMiddle'
      else if (posRaw === 'middle' || posRaw === 'middle2' || posRaw === 'centermid' || posRaw === 'mid') pos = 'middle'
      else if (posRaw === 'latemiddle' || posRaw === 'middle3' || posRaw === 'lastmid' || posRaw === 'latemid') pos = 'lateMiddle'
      else if (posRaw === 'closing' || posRaw === 'close' || posRaw === 'end') pos = 'closing'
      else continue
      const { position: _p, slot: _s, ...rest } = item
      // Coerce string start ("0:05") into numeric startTime
      if (typeof rest.start === 'string') {
        const sec = parseTimecodeToSeconds(rest.start)
        if (sec != null && rest.startTime == null) rest.startTime = sec
        delete rest.start
      }
      obj[pos] = rest
    }
    if (Object.keys(obj).length > 0) out.overlays = obj
  }

  // ── voiceover: stringy timestamps → numeric seconds ──
  if (Array.isArray(out.voiceover)) {
    out.voiceover = out.voiceover.map(seg => {
      if (!seg || typeof seg !== 'object') return seg
      const next = { ...seg }
      if (typeof next.start === 'string') {
        const sec = parseTimecodeToSeconds(next.start)
        if (sec != null) next.start = sec
      }
      if (typeof next.end === 'string') {
        const sec = parseTimecodeToSeconds(next.end)
        if (sec != null) next.end = sec
      }
      // Drop AI-only fields the schema doesn't care about — they'd
      // trip the "unknown keys" path in validation otherwise.
      delete next.word_count
      return next
    })
  }

  // ── channels: alias keys → canonical keys ──
  if (out.channels && typeof out.channels === 'object' && !Array.isArray(out.channels)) {
    const aliasMap = {
      youtube_shorts: 'youtube',
      youtube_short: 'youtube',
      yt_shorts: 'youtube',
      yt: 'youtube',
      google_business: 'google',
      google_business_profile: 'google',
      gbp: 'google',
      ig: 'instagram',
      fb: 'facebook',
      tt: 'tiktok',
    }
    const remapped = {}
    for (const [k, v] of Object.entries(out.channels)) {
      const canon = aliasMap[k] || k
      // Last-write wins if both alias and canonical present.
      remapped[canon] = v
    }
    // Per-channel coercion: hashtags string → array; drop hashtag_count.
    for (const key of Object.keys(remapped)) {
      const ch = remapped[key]
      if (!ch || typeof ch !== 'object') continue
      if (typeof ch.hashtags === 'string') {
        ch.hashtags = ch.hashtags.split(/\s+/).filter(Boolean)
      }
      delete ch.hashtag_count
    }
    out.channels = remapped
  }

  // ── Strip top-level fields the AI tacked on (video, totals…) ──
  for (const k of Object.keys(out)) {
    if (!['voice','overrides','hooks','voiceover','overlays','media','channels','version'].includes(k)) {
      delete out[k]
    }
  }

  return out
}

// "0:00" / "1:23.5" / "12.4" / "45" → seconds (number). Returns
// null when the string can't be interpreted.
function parseTimecodeToSeconds(s) {
  if (typeof s !== 'string') return null
  const trimmed = s.trim()
  if (!trimmed) return null
  // Plain numeric ("12.4")
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  // M:SS or M:SS.s
  const m = trimmed.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  // H:MM:SS or H:MM:SS.s
  const h = trimmed.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/)
  if (h) return Number(h[1]) * 3600 + Number(h[2]) * 60 + Number(h[3])
  return null
}

// Shape + range + type checks. Returns { ok, errors[] }. errors are
// human-readable strings; the UI shows the first 5. Unknown top-level
// keys are warned (logged) but don't fail validation — forward-compat
// for schema additions the AI gets ahead of.
export function validateFinalPackage(pkg) {
  const errors = []
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return { ok: false, errors: ['final-package must be a JSON object'] }
  }

  for (const k of Object.keys(pkg)) {
    if (!KNOWN_SECTIONS.has(k)) {
      console.warn(`[finalPackage] unknown top-level section "${k}" — ignoring`)
    }
  }

  const present = Object.keys(pkg).filter(k => KNOWN_SECTIONS.has(k) && k !== 'version')
  if (present.length === 0) {
    return { ok: false, errors: ['final-package has no recognized sections'] }
  }

  if (pkg.voice !== undefined) checkVoice(pkg.voice, errors)
  if (pkg.overrides !== undefined) checkOverrides(pkg.overrides, errors)
  if (pkg.hooks !== undefined) checkHooks(pkg.hooks, errors)
  if (pkg.voiceover !== undefined) checkVoiceover(pkg.voiceover, errors)
  if (pkg.overlays !== undefined) checkOverlays(pkg.overlays, errors)
  if (pkg.media !== undefined) checkMedia(pkg.media, errors)
  if (pkg.channels !== undefined) checkChannels(pkg.channels, errors)

  return { ok: errors.length === 0, errors }
}

// Resolve clip-<id> refs against current files. Returns:
//   { ok, resolved, removed[], errors[] }
// resolved = the package with each media[].ref replaced by the matched
// file's local id (so the apply layer can call jobSync save methods
// without re-resolving). removed = files whose _dbFileId isn't in the
// media block — these will be deleted on apply, which the diff UI must
// flag prominently.
export function normalizeFinalPackage(pkg, files) {
  const errors = []
  if (!Array.isArray(files)) files = []
  const fileByDbId = new Map()
  for (const f of files) {
    if (f && f._dbFileId != null) fileByDbId.set(Number(f._dbFileId), f)
  }
  const resolved = JSON.parse(JSON.stringify(pkg))

  if (Array.isArray(resolved.media)) {
    const referencedDbIds = new Set()
    for (let i = 0; i < resolved.media.length; i++) {
      const m = resolved.media[i]
      const dbId = parseClipRef(m.ref)
      if (dbId == null) {
        errors.push(`media[${i}].ref "${m.ref}" is not a valid clip ref`)
        continue
      }
      const file = fileByDbId.get(dbId)
      if (!file) {
        errors.push(`media[${i}].ref "clip-${dbId}" doesn't match any current file in this draft`)
        continue
      }
      m._resolvedFile = file
      m._resolvedDbId = dbId
      referencedDbIds.add(dbId)

      if (m.insertInto !== undefined && m.insertInto !== null) {
        const hostDbId = parseClipRef(m.insertInto)
        if (hostDbId == null) {
          errors.push(`media[${i}].insertInto "${m.insertInto}" is not a valid clip ref`)
        } else if (!fileByDbId.has(hostDbId)) {
          errors.push(`media[${i}].insertInto "clip-${hostDbId}" doesn't match any current file`)
        } else {
          m._resolvedInsertInto = hostDbId
        }
      }
    }

    const removed = []
    for (const f of files) {
      if (f && f._dbFileId != null && !referencedDbIds.has(Number(f._dbFileId))) {
        removed.push(f)
      }
    }
    return { ok: errors.length === 0, resolved, removed, errors }
  }

  return { ok: errors.length === 0, resolved, removed: [], errors }
}

function parseClipRef(ref) {
  if (typeof ref !== 'string') return null
  const m = ref.match(/^clip-(\d+)$/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function checkVoice(v, errors) {
  if (!isPlainObject(v)) { errors.push('voice must be an object'); return }
  if (v.tone !== undefined && !VALID_TONES.has(String(v.tone))) {
    errors.push(`voice.tone "${v.tone}" not in allowed set`)
  }
  if (v.pov !== undefined && !VALID_POVS.has(String(v.pov))) {
    errors.push(`voice.pov "${v.pov}" not in allowed set`)
  }
  if (v.marketing_intensity !== undefined && !VALID_MARKETING.has(String(v.marketing_intensity))) {
    errors.push(`voice.marketing_intensity "${v.marketing_intensity}" not in allowed set`)
  }
  if (v.off_topic !== undefined && typeof v.off_topic !== 'boolean') {
    errors.push('voice.off_topic must be boolean')
  }
}

function checkOverrides(o, errors) {
  if (!isPlainObject(o)) { errors.push('overrides must be an object'); return }
  for (const k of ['key_insights', 'audience_notes', 'posting_style', 'seo_keywords', 'default_hashtags_all']) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      errors.push(`overrides.${k} must be a string`)
    } else if (typeof o[k] === 'string' && o[k].length > 4000) {
      errors.push(`overrides.${k} too long (>4000 chars)`)
    }
  }
}

function checkHooks(h, errors) {
  if (!isPlainObject(h)) { errors.push('hooks must be an object'); return }
  if (h.selected !== undefined && typeof h.selected !== 'string') {
    errors.push('hooks.selected must be a string')
  }
  if (typeof h.selected === 'string' && h.selected.length > 1000) {
    errors.push('hooks.selected too long (>1000 chars)')
  }
}

function checkVoiceover(arr, errors) {
  if (!Array.isArray(arr)) { errors.push('voiceover must be an array'); return }
  if (arr.length > 30) errors.push('voiceover has too many segments (>30)')
  let prevEnd = 0
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i]
    if (!isPlainObject(s)) { errors.push(`voiceover[${i}] must be an object`); continue }
    if (typeof s.text !== 'string' || !s.text.trim()) {
      errors.push(`voiceover[${i}].text required (non-empty string)`)
    } else if (s.text.length > 2000) {
      errors.push(`voiceover[${i}].text too long`)
    }
    if (!isFiniteNum(s.start, 0, 600) || !isFiniteNum(s.end, 0, 600)) {
      errors.push(`voiceover[${i}].start/end must be numbers 0..600`)
    } else if (Number(s.end) <= Number(s.start)) {
      errors.push(`voiceover[${i}].end must be > start`)
    } else if (Number(s.start) < prevEnd - 0.001) {
      errors.push(`voiceover[${i}] starts before previous segment ends`)
    } else {
      prevEnd = Number(s.end)
    }
    if (s.showCaption !== undefined && typeof s.showCaption !== 'boolean') {
      errors.push(`voiceover[${i}].showCaption must be boolean`)
    }
  }
}

function checkOverlays(o, errors) {
  if (!isPlainObject(o)) { errors.push('overlays must be an object'); return }
  for (const slot of ['opening', 'earlyMiddle', 'middle', 'lateMiddle', 'closing']) {
    if (o[slot] === undefined) continue
    const v = o[slot]
    if (!isPlainObject(v)) { errors.push(`overlays.${slot} must be an object`); continue }
    if (typeof v.text !== 'string' || !v.text.trim()) {
      errors.push(`overlays.${slot}.text required`)
    } else if (v.text.length > 500) {
      errors.push(`overlays.${slot}.text too long`)
    }
    if (v.duration !== undefined && !isFiniteNum(v.duration, 0.1, 60)) {
      errors.push(`overlays.${slot}.duration must be 0.1..60`)
    }
    if (v.startTime !== undefined && !isFiniteNum(v.startTime, 0, 600)) {
      errors.push(`overlays.${slot}.startTime must be 0..600`)
    }
  }
}

function checkMedia(arr, errors) {
  if (!Array.isArray(arr)) { errors.push('media must be an array'); return }
  if (arr.length > 50) errors.push('media has too many entries (>50)')
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i]
    if (!isPlainObject(m)) { errors.push(`media[${i}] must be an object`); continue }
    if (parseClipRef(m.ref) == null) {
      errors.push(`media[${i}].ref must look like "clip-<id>"`)
    }
    if (m.trim !== undefined) {
      if (!Array.isArray(m.trim) || m.trim.length !== 2 || !isFiniteNum(m.trim[0], 0, 600) || !isFiniteNum(m.trim[1], 0, 600)) {
        errors.push(`media[${i}].trim must be [start, end] numbers`)
      } else if (Number(m.trim[1]) <= Number(m.trim[0])) {
        errors.push(`media[${i}].trim end must be > start`)
      }
    }
    if (m.photo !== undefined) checkPhotoSettings(m.photo, errors, `media[${i}].photo`)
    if (m.insertInto !== undefined && m.insertInto !== null && parseClipRef(m.insertInto) == null) {
      errors.push(`media[${i}].insertInto must be "clip-<id>" or null`)
    }
    if (m.insertAt !== undefined && !isFiniteNum(m.insertAt, 0, 600)) {
      errors.push(`media[${i}].insertAt must be 0..600`)
    }
  }
}

function checkPhotoSettings(p, errors, path) {
  if (!isPlainObject(p)) { errors.push(`${path} must be an object`); return }
  if (p.motion !== undefined && !VALID_MOTIONS.has(String(p.motion))) {
    errors.push(`${path}.motion "${p.motion}" not in allowed set`)
  }
  if (p.zoom !== undefined && !isFiniteNum(p.zoom, 0.5, 5)) {
    errors.push(`${path}.zoom must be 0.5..5`)
  }
  if (p.rotate !== undefined && !isFiniteNum(p.rotate, -180, 180)) {
    errors.push(`${path}.rotate must be -180..180`)
  }
  if (p.offsetX !== undefined && !isFiniteNum(p.offsetX, -100, 100)) {
    errors.push(`${path}.offsetX must be -100..100`)
  }
  if (p.offsetY !== undefined && !isFiniteNum(p.offsetY, -100, 100)) {
    errors.push(`${path}.offsetY must be -100..100`)
  }
  if (p.duration !== undefined && !isFiniteNum(p.duration, 0.1, 60)) {
    errors.push(`${path}.duration must be 0.1..60`)
  }
}

function checkChannels(c, errors) {
  if (!isPlainObject(c)) { errors.push('channels must be an object'); return }
  for (const k of Object.keys(c)) {
    if (!KNOWN_CHANNELS.has(k)) {
      console.warn(`[finalPackage] unknown channel "${k}" — ignoring`)
      continue
    }
    const v = c[k]
    if (!isPlainObject(v)) { errors.push(`channels.${k} must be an object`); continue }
    if (v.caption !== undefined && typeof v.caption !== 'string') {
      errors.push(`channels.${k}.caption must be a string`)
    } else if (typeof v.caption === 'string' && v.caption.length > 5000) {
      errors.push(`channels.${k}.caption too long`)
    }
    if (v.hashtags !== undefined) {
      if (!Array.isArray(v.hashtags)) {
        errors.push(`channels.${k}.hashtags must be an array`)
      } else if (v.hashtags.some(h => typeof h !== 'string')) {
        errors.push(`channels.${k}.hashtags must be array of strings`)
      } else if (v.hashtags.length > 50) {
        errors.push(`channels.${k}.hashtags too many (>50)`)
      }
    }
    if (v.title !== undefined && typeof v.title !== 'string') {
      errors.push(`channels.${k}.title must be a string`)
    }
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isFiniteNum(v, min, max) {
  const n = Number(v)
  if (!Number.isFinite(n)) return false
  if (min != null && n < min) return false
  if (max != null && n > max) return false
  return true
}
