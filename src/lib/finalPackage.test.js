// Light, dependency-free smoke tests for finalPackage.js. Run with
//   node src/lib/finalPackage.test.js
// Exits non-zero on first failure. Not part of the production bundle.

import {
  parseFinalPackage,
  validateFinalPackage,
  normalizeFinalPackage,
} from './finalPackage.js'

let failed = 0
function eq(label, got, want) {
  const okStr = JSON.stringify(want) === JSON.stringify(got)
  if (!okStr) {
    failed++
    console.error(`FAIL ${label}\n  want=${JSON.stringify(want)}\n  got =${JSON.stringify(got)}`)
  } else {
    console.log(`ok   ${label}`)
  }
}
function truthy(label, v) {
  if (!v) {
    failed++
    console.error(`FAIL ${label}: not truthy (${JSON.stringify(v)})`)
  } else console.log(`ok   ${label}`)
}

// parseFinalPackage
eq('parse: missing block returns null', parseFinalPackage('hello'), null)
eq('parse: empty input', parseFinalPackage(''), null)
const replyWithBlock = "summary above\n```final-package\n{\"voice\":{\"tone\":\"playful\"}}\n```\nafter"
eq('parse: extracts block', parseFinalPackage(replyWithBlock), { voice: { tone: 'playful' } })
eq('parse: malformed JSON returns null', parseFinalPackage("```final-package\n{not json\n```"), null)

// validateFinalPackage — happy path
const happy = {
  voice: { tone: 'warm-conversational', pov: 'first-person', off_topic: false },
  voiceover: [
    { id: 'vo-1', start: 0, end: 4.2, text: 'hello', showCaption: true },
    { id: 'vo-2', start: 4.2, end: 8.5, text: 'world', showCaption: false },
  ],
  overlays: { opening: { text: 'open', duration: 3 } },
  media: [
    { ref: 'clip-42', trim: [0, 2.4] },
    { ref: 'clip-43', photo: { motion: 'zoom-out', zoom: 1.4, offsetX: -10 }, insertInto: 'clip-42', insertAt: 1.2 },
  ],
  channels: { tiktok: { caption: 'hi', hashtags: ['#a', '#b'] } },
}
const v1 = validateFinalPackage(happy)
truthy('validate: happy path ok', v1.ok)
eq('validate: happy path no errors', v1.errors, [])

// validateFinalPackage — failure cases
const v2 = validateFinalPackage({})
truthy('validate: empty object fails', !v2.ok)

const v3 = validateFinalPackage({ media: [{ ref: 'not-a-clip' }] })
truthy('validate: bad ref shape fails', !v3.ok)

const v4 = validateFinalPackage({
  voiceover: [
    { start: 0, end: 5, text: 'a' },
    { start: 3, end: 8, text: 'b' }, // overlaps prev
  ],
})
truthy('validate: overlapping VO fails', !v4.ok)

const v5 = validateFinalPackage({ media: [{ ref: 'clip-1', photo: { zoom: 99 } }] })
truthy('validate: out-of-range zoom fails', !v5.ok)

// normalizeFinalPackage
const files = [
  { _dbFileId: 42, id: 'a' },
  { _dbFileId: 43, id: 'b' },
  { _dbFileId: 99, id: 'c' }, // not in pkg.media → should be in removed
]
const n1 = normalizeFinalPackage(happy, files)
truthy('normalize: ok', n1.ok)
eq('normalize: removed list', n1.removed.map(f => f._dbFileId), [99])
eq('normalize: ref resolved', n1.resolved.media[0]._resolvedDbId, 42)
eq('normalize: insertInto resolved', n1.resolved.media[1]._resolvedInsertInto, 42)

const n2 = normalizeFinalPackage(
  { media: [{ ref: 'clip-9999' }] },
  files,
)
truthy('normalize: unknown clip fails', !n2.ok)

console.log(failed === 0 ? '\n✓ all passed' : `\n✗ ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
