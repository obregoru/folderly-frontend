// Parse a pasted voiceover script into { startTime, text } lines.
// Accepts permissive formats produced by ChatGPT / Claude / humans:
//   [0:00] hello                    ← preferred
//   0:00 hello
//   (0:05) hello
//   00:00 - hello
//   0:00  hello                     (two-space delimiter)
//   {"segments":[{"start":0,"text":"hi"},...]}  ← JSON
// Lines with no timestamp keep the previous timestamp + a small offset;
// first untimed line defaults to 0.

const TIME_RE = /^[\s*>-]*[\[(]?\s*(\d{1,3}):(\d{2}(?:\.\d+)?)\s*[\])]?\s*[-:.,|]?\s*(.*)$/

function mmssToSeconds(m, s) {
  return Number(m) * 60 + parseFloat(s)
}

export function parseVoiceoverScript(raw) {
  if (!raw || typeof raw !== 'string') return []
  const text = raw.trim()
  if (!text) return []

  // JSON form: try first
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const json = JSON.parse(text)
      const arr = Array.isArray(json) ? json : (Array.isArray(json.segments) ? json.segments : null)
      if (arr) {
        return arr
          .map((s) => {
            const t = Number(s.start ?? s.startTime ?? s.time ?? s.at ?? 0) || 0
            const txt = String(s.text ?? s.caption ?? s.line ?? '').trim()
            return txt ? { startTime: t, text: txt } : null
          })
          .filter(Boolean)
      }
    } catch {}
  }

  // Line-by-line form
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const out = []
  let lastTime = 0
  let untimedOffset = 0

  for (const line of lines) {
    const m = line.match(TIME_RE)
    if (m && m[3]) {
      const secs = mmssToSeconds(m[1], m[2])
      const body = m[3].trim().replace(/^[-:.,|]\s*/, '')
      if (body) {
        out.push({ startTime: secs, text: body })
        lastTime = secs
        untimedOffset = 0
      }
    } else if (/^\d+$/.test(line)) {
      // SRT sequence number — skip
    } else if (/^\d{1,2}:\d{2}(?:[:.]\d{2,3})?\s*-->\s*/.test(line)) {
      // SRT timestamp line "00:00:00,000 --> 00:00:03,000"
      const tm = line.match(/^(\d{1,2}):(\d{2})(?:[:.](\d{2,3}))?/)
      if (tm) {
        const hrs = Number(tm[1])
        const mins = Number(tm[2])
        lastTime = (hrs >= 10 ? hrs * 60 : 0) + (hrs < 10 ? hrs * 60 + mins : mins)
        // Actually SRT uses HH:MM:SS,mmm — better to parse that properly:
        const full = line.match(/(\d{1,2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?/)
        if (full) {
          lastTime = Number(full[1]) * 3600 + Number(full[2]) * 60 + Number(full[3])
        }
        untimedOffset = 0
      }
    } else {
      // Untimed text — attach to previous block with a small offset so
      // back-to-back pasted paragraphs don't stack at identical times.
      const t = lastTime + untimedOffset
      untimedOffset += 3 // guess ~3s per paragraph
      out.push({ startTime: t, text: line })
    }
  }
  // De-dupe identical consecutive lines
  return out.filter((s, i, a) => !(i > 0 && a[i - 1].text === s.text && a[i - 1].startTime === s.startTime))
}

// Serialize the current primary + segments back into the simple pasteable
// format so users can round-trip through ChatGPT for refinement.
export function exportVoiceoverScript({ primaryText, primaryStartTime = 0, segments = [] } = {}) {
  const items = []
  if (primaryText && primaryText.trim()) {
    items.push({ startTime: Number(primaryStartTime) || 0, text: primaryText.trim() })
  }
  for (const s of segments) {
    if (s.text && s.text.trim()) items.push({ startTime: Number(s.startTime) || 0, text: s.text.trim() })
  }
  items.sort((a, b) => a.startTime - b.startTime)
  const fmt = (t) => {
    const m = Math.floor(t / 60)
    const s = Math.floor(t - m * 60)
    const decimals = (t % 1 > 0.01) ? (t - Math.floor(t)).toFixed(1).slice(1) : ''
    return `${m}:${String(s).padStart(2, '0')}${decimals}`
  }
  return items.map(i => `[${fmt(i.startTime)}] ${i.text}`).join('\n')
}

// A ready-to-paste prompt the user can drop into ChatGPT/Claude to produce
// a script in the format this parser likes.
export function buildScriptPrompt(ctx = {}) {
  const { businessType, location, videoHint, duration } = ctx
  const lines = [
    'Write a short voiceover script for a social-media reel/TikTok.',
    'Format: one line per spoken chunk, each prefixed with a timestamp in square brackets like [0:00], [0:05], [0:12], etc.',
    'Keep each line SHORT (one sentence, ~1–2 seconds of speech).',
    'Do not include stage directions, speaker labels, emojis, hashtags, or URLs — this will be fed to a TTS engine.',
    'Total script should fit within the video duration below.',
    '',
  ]
  if (businessType) lines.push(`BUSINESS: ${businessType}${location ? ` in ${location}` : ''}`)
  if (videoHint) lines.push(`VIDEO CONTEXT: ${videoHint}`)
  if (duration) lines.push(`VIDEO DURATION: ~${duration}s`)
  lines.push('', 'Return ONLY the timestamped lines. No preamble, no explanation.')
  return lines.join('\n')
}
