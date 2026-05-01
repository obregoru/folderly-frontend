// Shared helpers for building download filenames that prefer the job name,
// fall back to the source file name, and finally to a generic name so
// desktop saves are always meaningful.

// Strip characters that would be awkward in a filename on Win/Mac/Linux.
function sanitizeForFilename(s) {
  if (!s) return ''
  return String(s)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // illegal on Windows/macOS
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

// Given an item (file in App state) or a job-name string and an optional file,
// return a sanitized base name suitable for a download. Falls back to the
// uploaded file's name (without extension), then to "posty-video".
export function downloadBaseName(source, fallbackFile) {
  // Accept either an item object with { job_name, file } or a raw string
  if (typeof source === 'string') {
    const clean = sanitizeForFilename(source)
    if (clean) return clean
  } else if (source && typeof source === 'object') {
    const clean = sanitizeForFilename(source.job_name || source.jobName)
    if (clean) return clean
    const file = fallbackFile || source.file
    const name = file?.name || source._filename
    if (name) {
      const base = name.replace(/\.[^.]+$/, '')
      const cleanFile = sanitizeForFilename(base)
      if (cleanFile) return cleanFile
    }
  }
  return 'posty-video'
}

// Pull a short, sanitized "description" slug from a job description. The
// hint_text field stores a brief and angles separated by `\n---\n`; we
// only want the brief portion, capped to a small piece so the combined
// filename stays under ~80 chars.
function descriptionSlug(description, maxLen = 40) {
  if (!description) return ''
  const brief = String(description).split('\n---\n')[0] || ''
  // Take up to ~6 words so we don't dump the whole brief into a filename.
  const words = brief.trim().split(/\s+/).slice(0, 6).join(' ')
  return sanitizeForFilename(words).slice(0, maxLen).replace(/-+$/g, '')
}

// Full filename: base + optional description + optional suffix + extension.
// Example: buildDownloadName(item, 'final', 'mp4', 'A reveal of our Aug candle')
//   -> "my-candle-reveal-a-reveal-of-our-aug-final.mp4"
// description is optional — when omitted (or empty) the filename is just
// base[-suffix].ext, same as before.
export function buildDownloadName(source, suffix = '', ext = 'mp4', description = '') {
  const base = downloadBaseName(source)
  const descPart = description ? `-${descriptionSlug(description)}` : ''
  const suffixPart = suffix ? `-${sanitizeForFilename(suffix)}` : ''
  return `${base}${descPart}${suffixPart}.${ext.replace(/^\./, '')}`
}
