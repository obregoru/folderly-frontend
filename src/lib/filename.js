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

// Full filename: base + optional suffix + extension.
// Example: buildDownloadName(item, 'overlay', 'mp4') -> "my-candle-reveal-overlay.mp4"
export function buildDownloadName(source, suffix = '', ext = 'mp4') {
  const base = downloadBaseName(source)
  const suffixPart = suffix ? `-${sanitizeForFilename(suffix)}` : ''
  return `${base}${suffixPart}.${ext.replace(/^\./, '')}`
}
