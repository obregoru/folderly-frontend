// Caption-style fingerprint — browser port of the backend's
// lib/style-fp.js. Both must stay in sync so server-emitted
// [preview-log] style_fp values match client-emitted ones for the
// same style config; drift there invalidates session analysis.
//
// Source of truth: /folderly-backend/lib/style-fp.js.
// If the algorithm changes there, update here.

export function stableStringify(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const keys = Object.keys(v).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
}

// Async because Web Crypto's SubtleCrypto.digest returns a Promise.
// Backend's sync crypto.createHash produces the same hex string —
// same bytes in, same bytes out.
export async function hashStyleSet(segmentStyles, defaultStyle) {
  const resolved = (segmentStyles || []).map(s => s || defaultStyle || null)
  const serialized = resolved.map(stableStringify)
  const unique = Array.from(new Set(serialized)).sort()
  const payload = JSON.stringify({
    default: stableStringify(defaultStyle || null),
    styles: unique,
  })
  const bytes = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 12)
}
