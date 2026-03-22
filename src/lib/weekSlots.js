// Week slot calculation utilities for the weekly planner

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Parse a time string like "11:30 AM" or "7:00 PM" into { hours, mins }
 */
function parseTime(timeStr) {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return null
  let hours = parseInt(match[1])
  const mins = parseInt(match[2])
  const ampm = match[3].toUpperCase()
  if (ampm === 'PM' && hours !== 12) hours += 12
  if (ampm === 'AM' && hours === 12) hours = 0
  return { hours, mins }
}

/**
 * Get the start of a week (Sunday) for a given date
 */
export function getWeekStart(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Map a posting schedule slot (day + time) to a concrete date within a target week
 * @param {string} day - "Monday", "Tuesday", etc.
 * @param {string} time - "11:30 AM", "7:00 PM", etc.
 * @param {Date} weekStart - Sunday of the target week
 * @returns {Date|null}
 */
export function slotToDate(day, time, weekStart) {
  const dayIndex = DAY_NAMES.indexOf(day)
  if (dayIndex === -1) return null
  const parsed = parseTime(time)
  if (!parsed) return null

  const date = new Date(weekStart)
  date.setDate(date.getDate() + dayIndex)
  date.setHours(parsed.hours, parsed.mins, 0, 0)
  return date
}

/**
 * Get all available slots for a platform within a target week,
 * filtering out slots that conflict with existing scheduled posts
 * @param {object} platformSchedule - { platform, slots: [{ day, time, reason }] }
 * @param {Date} weekStart - Sunday of the target week
 * @param {object} existingPosts - { platform: { scheduled, posted } } for the week
 * @returns {Array<{ date: Date, day: string, time: string, reason: string }>}
 */
export function getAvailableSlots(platformSchedule, weekStart, existingPosts = {}) {
  if (!platformSchedule?.slots) return []

  const now = new Date()
  return platformSchedule.slots
    .map(slot => ({
      ...slot,
      date: slotToDate(slot.day, slot.time, weekStart),
    }))
    .filter(slot => slot.date && slot.date > now)
    .sort((a, b) => a.date - b.date)
}

/**
 * Get the recommended max posts per week for a platform based on its schedule
 */
export function getMaxPerWeek(platformSchedule) {
  return platformSchedule?.slots?.length || 3
}

/**
 * Calculate saturation info for a week
 * @param {object} weekData - { platforms: { instagram: { scheduled, posted }, ... } }
 * @param {Array} schedule - posting_schedule.schedule array
 * @returns {Array<{ platform, current, max, status }>}
 */
export function getWeekSaturation(weekData, schedule) {
  if (!schedule || !weekData) return []

  return schedule.map(platSched => {
    const platKey = platSched.platform.toLowerCase().replace(/\s.*/, '')
    const current = (weekData.platforms?.[platKey]?.scheduled || 0) + (weekData.platforms?.[platKey]?.posted || 0)
    const max = getMaxPerWeek(platSched)
    const status = current >= max ? (current > max ? 'over' : 'full') : 'open'
    return { platform: platSched.platform, platKey, current, max, status }
  })
}

/**
 * Format a week range for display
 */
export function formatWeekRange(weekStart) {
  const start = new Date(weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts = { month: 'short', day: 'numeric' }
  const startStr = start.toLocaleDateString(undefined, opts)
  const endStr = end.toLocaleDateString(undefined, { ...opts, year: start.getFullYear() !== end.getFullYear() ? 'numeric' : undefined })
  return `${startStr} – ${endStr}`
}

/**
 * Check if a date falls in the current week
 */
export function isCurrentWeek(weekStart) {
  const now = getWeekStart(new Date())
  const ws = new Date(weekStart)
  ws.setHours(0, 0, 0, 0)
  return now.getTime() === ws.getTime()
}
