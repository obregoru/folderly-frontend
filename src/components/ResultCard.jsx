import { useState, useEffect, useCallback, useRef } from 'react'
import { allTags } from '../lib/parse'
import { CROP_RATIOS, smartCrop, applyWatermark } from '../lib/crop'
import { getWeekStart, slotToDate, getAvailableSlots, formatWeekRange } from '../lib/weekSlots'
import CropStrip from './CropStrip'

// Read file as ArrayBuffer and convert to base64 (works on iOS unlike readAsDataURL for large files)
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => {
    const bytes = new Uint8Array(r.result)
    let binary = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    resolve(btoa(binary))
  }
  r.onerror = reject
  r.readAsArrayBuffer(file)
})

// Map platform to preferred crop ratio
const PLATFORM_CROPS = {
  tiktok: CROP_RATIOS.find(c => c.label.startsWith('TikTok')),
  instagram: CROP_RATIOS.find(c => c.label === 'IG Square 1:1'),
  facebook: CROP_RATIOS.find(c => c.label.startsWith('FB')),
  twitter: CROP_RATIOS.find(c => c.label.startsWith('X ')),
  google: CROP_RATIOS.find(c => c.label.startsWith('Google')),
  pinterest: CROP_RATIOS.find(c => c.label.startsWith('Pinterest')),
  blog: CROP_RATIOS.find(c => c.label.startsWith('FB')), // 16:9 for blog featured images
}

const PLATFORMS = [
  { key: 'tiktok', label: 'TikTok', color: '#2D9A5E' },
  { key: 'instagram', label: 'Instagram', color: '#B5318A' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2' },
  { key: 'twitter', label: 'X', color: '#000000' },
  { key: 'google', label: 'Google', color: '#4285F4' },
  { key: 'pinterest', label: 'Pinterest', color: '#E60023' },
  { key: 'blog', label: 'Blog', color: '#E67E22' },
  { key: 'youtube', label: 'YouTube', color: '#FF0000' },
]

function getText(cap) {
  if (!cap) return ''
  return typeof cap === 'object' ? (cap.text || '') : cap
}

function getTitle(cap) {
  if (!cap || typeof cap !== 'object') return ''
  return cap.title || ''
}

function getTags(cap) {
  if (!cap || typeof cap !== 'object') return []
  return cap.tags || []
}

function getId(cap) {
  if (!cap) return null
  return typeof cap === 'object' ? cap.id : null
}

function getScore(cap) {
  if (!cap || typeof cap !== 'object') return null
  return cap.ai_score || null
}

export default function ResultCard({ item, folderCtx, onRegen, onUpdateCaption, onRefine, apiUrl, settings, targetWeek }) {
  // Find which platforms have captions
  const available = item.captions
    ? PLATFORMS.filter(p => item.captions[p.key])
    : []

  const [tab, setTab] = useState('')

  // Set tab when captions arrive or change
  useEffect(() => {
    if (available.length > 0) {
      setTab(prev => {
        // Keep current tab if still valid
        if (prev && available.some(p => p.key === prev)) return prev
        return available[0].key
      })
    }
  }, [item.captions])

  // Tags
  const tags = [...new Set([
    ...(folderCtx ? allTags(folderCtx.parsed) : []),
    ...allTags(item.parsed)
  ])]

  // Thumbnail src
  const thumbSrc = item.isImg
    ? URL.createObjectURL(item.file)
    : (item.uploadResult?.thumbnail_path
      ? (item.uploadResult.thumbnail_path.startsWith('http') ? item.uploadResult.thumbnail_path : `/uploads/${item.uploadResult.thumbnail_path}`)
      : null)
  const isVideo = item.file?.type?.startsWith('video/')
  const [showPreview, setShowPreview] = useState(false)

  return (
    <div className="bg-white border border-border rounded mb-2.5">
      {/* Media preview lightbox */}
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="relative max-w-[90vw] max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowPreview(false)} className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10">&times;</button>
            {isVideo ? (
              <video
                src={URL.createObjectURL(item.file)}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-[80vh] rounded"
              />
            ) : (
              <img
                src={thumbSrc}
                className="max-w-full max-h-[80vh] rounded object-contain"
              />
            )}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-2.5 py-2.5 px-3.5 border-b border-border bg-cream">
        {thumbSrc ? (
          <img src={thumbSrc} onClick={() => setShowPreview(true)} className="w-9 h-9 rounded-sm object-cover flex-shrink-0 cursor-pointer hover:opacity-80" />
        ) : isVideo ? (
          <div onClick={() => setShowPreview(true)} className="w-9 h-9 rounded-sm bg-ink flex items-center justify-center text-white text-[13px] flex-shrink-0 cursor-pointer hover:bg-[#333]">▶</div>
        ) : (
          <div className="w-9 h-9 rounded-sm bg-ink flex items-center justify-center text-white text-[13px] flex-shrink-0">▶</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" title={item.file.name}>{item.file.name}</div>
          {tags.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-0.5">
              {tags.map(t => <span key={t} className="inline-block bg-sage-light text-sage border border-[#C2D4C9] rounded-full px-[7px] text-[10px]">{t}</span>)}
            </div>
          )}
        </div>
      </div>

      {/* Dedup warning */}
      {item.previouslyUsed && (
        <div className="py-2 px-3.5 text-[11px] bg-[#FFF3CD] text-[#856404] mx-3.5 mt-2 rounded-sm">
          This photo was previously used. Captions generated anyway.
        </div>
      )}

      {/* Loading */}
      {item.status === 'loading' && (
        <div className="py-3 px-3.5">
          <div className="skel" style={{ width: '86%' }} />
          <div className="skel" style={{ width: '70%' }} />
          <div className="skel" style={{ width: '78%' }} />
        </div>
      )}

      {/* Error */}
      {item.status === 'error' && (
        <div className="py-3 px-3.5 text-xs text-[#A32D2D]">{item.errMsg || 'Error generating captions.'}</div>
      )}

      {/* Post All */}
      {available.length > 0 && (
        <PostAllBar item={item} available={available} settings={settings} apiUrl={apiUrl} targetWeek={targetWeek} />
      )}

      {/* Caption tabs + content */}
      {available.length > 0 && (
        <>
          <div className="flex border-b border-border">
            {available.map(p => (
              <button
                key={p.key}
                onClick={() => setTab(p.key)}
                className="flex-1 py-2 px-1 text-[11px] font-medium text-center cursor-pointer border-none bg-transparent font-sans"
                style={{
                  color: tab === p.key ? p.color : '#7A756F',
                  borderBottom: tab === p.key ? `2px solid ${p.color}` : '2px solid transparent'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {available.map(p => {
            if (tab !== p.key) return null
            const cap = item.captions[p.key]
            return (
              <div key={p.key} className="py-3 px-3.5">
                <CaptionEditor
                  text={getText(cap)}
                  blogTitle={getTitle(cap)}
                  ytTags={getTags(cap)}
                  captionId={getId(cap)}
                  score={getScore(cap)}
                  platform={p.key}
                  item={item}
                  settings={settings}
                  apiUrl={apiUrl}
                  onSave={(newText) => onUpdateCaption(p.key, newText, getId(cap))}
                  onRegen={onRegen}
                  onRefine={(val) => onRefine(val, p.key, getId(cap))}
                />
              </div>
            )
          })}
        </>
      )}

      <CropStrip item={item} apiUrl={apiUrl} />
    </div>
  )
}

const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', blog: 'WordPress', tiktok: 'TikTok', google: 'Google', youtube: 'YouTube', pinterest: 'Pinterest' }
const PLATFORM_COLORS = { facebook: '#1877F2', instagram: '#E1306C', twitter: '#000', blog: '#21759B', tiktok: '#2D9A5E', google: '#4285F4', youtube: '#FF0000', pinterest: '#E60023' }

function PostAllBar({ item, available, settings, apiUrl, targetWeek }) {
  const [posting, setPosting] = useState(false)
  const [results, setResults] = useState({}) // { platform: 'success' | 'Failed: ...' }
  const [wpPublishAll, setWpPublishAll] = useState(false)
  const [wpCategories, setWpCategories] = useState([])
  const [selectedCats, setSelectedCats] = useState([])
  const [wpCatsLoaded, setWpCatsLoaded] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [scheduleStatus, setScheduleStatus] = useState('')
  const [useSuggestedTimes, setUseSuggestedTimes] = useState(false)
  const [includeStories, setIncludeStories] = useState(settings?.fb_stories_default === true)
  const [schedStoryCaptionStyle, setSchedStoryCaptionStyle] = useState('none')
  const [schedStoryText, setSchedStoryText] = useState('')
  const [schedOverlayYPct, setSchedOverlayYPct] = useState(70)
  const [schedStoryFontSize, setSchedStoryFontSize] = useState(48)
  const [schedStoryFontFamily, setSchedStoryFontFamily] = useState('sans-serif')
  const [schedStoryFontColor, setSchedStoryFontColor] = useState('#ffffff')
  const [schedStoryFontOutline, setSchedStoryFontOutline] = useState(false)
  const [schedOpeningText, setSchedOpeningText] = useState('')
  const [schedClosingText, setSchedClosingText] = useState('')
  const [schedOpeningDuration, setSchedOpeningDuration] = useState(3)
  const [schedClosingDuration, setSchedClosingDuration] = useState(3)

  const hasWp = available.some(p => p.key === 'blog') && settings?.wp_site_url
  useEffect(() => {
    if (hasWp && !wpCatsLoaded) {
      import('../api').then(api => api.getWpCategories()).then(cats => {
        if (Array.isArray(cats)) setWpCategories(cats)
        setWpCatsLoaded(true)
      }).catch(() => setWpCatsLoaded(true))
    }
  }, [hasWp, wpCatsLoaded])

  // Determine which platforms can post or should be scheduled (even if manual-only)
  const postable = available.filter(p => {
    if (p.key === 'facebook' && settings?.fb_connected) return true
    if (p.key === 'instagram' && settings?.ig_connected) return true
    if (p.key === 'twitter' && settings?.twitter_connected) return true
    if (p.key === 'google' && settings?.google_connected) return true
    if (p.key === 'blog' && settings?.wp_site_url) return true
    if (p.key === 'tiktok') return true // Always include — manual posting with notifications
    if (p.key === 'youtube' && settings?.youtube_connected) return true
    if (p.key === 'pinterest' && settings?.pinterest_connected) return true
    return false
  })

  if (postable.length === 0) return null

  const handlePostAll = async () => {
    setPosting(true)
    setResults({})
    const api = await import('../api')
    const newResults = {}

    for (const p of postable) {
      const caption = getText(item.captions[p.key])
      if (!caption) { newResults[p.key] = 'Skipped: no caption'; continue }

      try {
        // Get platform-cropped watermarked image
        let imageBase64 = null, mediaType = null
        if (item.isImg && item.file) {
          const cropRatio = PLATFORM_CROPS[p.key]
          if (cropRatio) {
            let blob = await smartCrop(item, cropRatio)
            blob = await applyWatermark(blob, cropRatio.wm, apiUrl)
            imageBase64 = await new Promise((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(r.result.split(',')[1])
              r.onerror = reject
              r.readAsDataURL(blob)
            })
            mediaType = 'image/jpeg'
          }
        }

        if (p.key === 'facebook') {
          await api.postToFacebook(caption, imageBase64, mediaType)
          newResults[p.key] = 'success'
        } else if (p.key === 'instagram') {
          if (!imageBase64) throw new Error('Requires a photo')
          await api.postToInstagram(caption, imageBase64, mediaType)
          newResults[p.key] = 'success'
        } else if (p.key === 'twitter') {
          await api.postToTwitter(caption, imageBase64, mediaType)
          newResults[p.key] = 'success'
        } else if (p.key === 'google') {
          await api.postToGoogle(caption, imageBase64, mediaType)
          newResults[p.key] = 'success'
        } else if (p.key === 'pinterest') {
          if (!imageBase64) throw new Error('Requires a photo')
          await api.postToPinterest(caption, imageBase64, mediaType)
          newResults[p.key] = 'success'
        } else if (p.key === 'youtube') {
          if (!imageBase64 || !item.file?.type?.startsWith('video/')) throw new Error('Requires a video')
          const ytCap = item.captions?.youtube
          const ytCaption = JSON.stringify({ title: (ytCap && typeof ytCap === 'object' ? ytCap.title : null) || item.name || 'Short', description: caption, tags: (ytCap && typeof ytCap === 'object' ? ytCap.tags : null) || [] })
          await api.postToYoutubeShorts(ytCaption, imageBase64, item.file.type)
          newResults[p.key] = 'success'
        } else if (p.key === 'blog') {
          const blogCap = item.captions[p.key]
          const wpTitle = getTitle(blogCap) || item.name || item.file?.name?.replace(/\.[^.]+$/, '') || 'New Post'
          await api.postToWordPress(wpTitle, caption, imageBase64, mediaType, selectedCats, wpPublishAll)
          newResults[p.key] = wpPublishAll ? 'success' : 'draft'
        }
      } catch (err) {
        newResults[p.key] = 'Failed: ' + err.message
      }

      // Update results as we go
      setResults({ ...newResults })
    }

    setPosting(false)
  }

  const buildPostsPayload = async () => {
    const posts = []
    for (const p of postable) {
      const caption = getText(item.captions[p.key])
      if (!caption) continue

      let imageBase64 = null, mediaType = null
      const isVideo = item.file?.type?.startsWith('video/')
      if (item.isImg && item.file) {
        const cropRatio = PLATFORM_CROPS[p.key]
        if (cropRatio) {
          let blob = await smartCrop(item, cropRatio)
          blob = await applyWatermark(blob, cropRatio.wm, apiUrl)
          imageBase64 = await new Promise((resolve, reject) => {
            const r = new FileReader()
            r.onload = () => resolve(r.result.split(',')[1])
            r.onerror = reject
            r.readAsDataURL(blob)
          })
          mediaType = 'image/jpeg'
        }
      } else if (isVideo && item.file) {
        try { imageBase64 = await fileToBase64(item.file) } catch { imageBase64 = null }
        mediaType = item.file.type
      }

      const post = { platform: p.key, caption, image_base64: imageBase64, media_type: mediaType }
      if (p.key === 'blog') {
        const blogCap = item.captions[p.key]
        post.title = getTitle(blogCap) || item.name || item.file?.name?.replace(/\.[^.]+$/, '') || 'New Post'
        post.wp_publish = wpPublishAll
        post.wp_category_ids = selectedCats
      }
      if (p.key === 'youtube') {
        const ytCap = item.captions[p.key]
        const ytTitle = (ytCap && typeof ytCap === 'object' ? ytCap.title : null) || item.name || 'Short video'
        const ytTags = (ytCap && typeof ytCap === 'object' ? ytCap.tags : null) || ['Shorts']
        post.title = ytTitle
        post.caption = JSON.stringify({ title: ytTitle, description: caption, tags: ytTags })
      }
      posts.push(post)

      // Add story post for FB/IG if stories are included
      if (includeStories && (p.key === 'facebook' || p.key === 'instagram')) {
        const storyPlatform = p.key === 'facebook' ? 'facebook_story' : 'instagram_story'
        const storyCaption = schedStoryCaptionStyle === 'overlay' ? (schedStoryText || caption) : caption
        posts.push({
          platform: storyPlatform,
          caption: storyCaption,
          image_base64: imageBase64,
          media_type: mediaType,
          caption_style: schedStoryCaptionStyle,
          overlay_y_pct: schedOverlayYPct,
          font_size: schedStoryFontSize,
          font_family: schedStoryFontFamily,
          font_color: schedStoryFontColor,
          font_outline: schedStoryFontOutline,
          opening_text: schedOpeningText,
          closing_text: schedClosingText,
          opening_duration: schedOpeningDuration,
          closing_duration: schedClosingDuration,
          _story_offset: true, // flag for scheduler to offset by 45 min
        })
      }
    }
    return posts
  }

  // Find the next occurrence of a day/time slot from now
  const getNextSlotDate = (day, timeStr) => {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const targetDay = dayNames.indexOf(day)
    if (targetDay === -1) return null

    // Parse time like "11:30 AM" or "7:00 PM"
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
    if (!match) return null
    let hours = parseInt(match[1])
    const mins = parseInt(match[2])
    const ampm = match[3].toUpperCase()
    if (ampm === 'PM' && hours !== 12) hours += 12
    if (ampm === 'AM' && hours === 12) hours = 0

    const now = new Date()
    const result = new Date()
    result.setHours(hours, mins, 0, 0)

    // Find the next occurrence of this day
    const currentDay = now.getDay()
    let daysAhead = targetDay - currentDay
    if (daysAhead < 0) daysAhead += 7
    if (daysAhead === 0 && result <= now) daysAhead = 7
    result.setDate(result.getDate() + daysAhead)

    return result
  }

  const handleScheduleAll = async () => {
    setScheduling(true)
    setScheduleStatus('')
    try {
      const api = await import('../api')
      const posts = await buildPostsPayload()

      if ((useSuggestedTimes || targetWeek) && settings?.posting_schedule?.schedule) {
        // Schedule each platform at its best time (within target week if set, otherwise next available)
        const schedule = settings.posting_schedule.schedule
        const weekStart = targetWeek ? getWeekStart(targetWeek) : null
        let totalScheduled = 0
        const scheduledTimes = {} // track feed post times for story offset
        for (const post of posts) {
          const isStoryPost = post._story_offset
          // For stories, use the parent platform's scheduled time + 45 min
          const basePlatform = post.platform.replace('_story', '')

          if (isStoryPost && scheduledTimes[basePlatform]) {
            const storyTime = new Date(scheduledTimes[basePlatform].getTime() + 45 * 60 * 1000)
            const result = await api.schedulePosts([post], storyTime.toISOString())
            totalScheduled += result.scheduled?.length || 0
            continue
          }

          const lookupPlatform = basePlatform
          const platSchedule = schedule.find(s =>
            s.platform.toLowerCase().includes(lookupPlatform) ||
            lookupPlatform.includes(s.platform.toLowerCase())
          )
          if (platSchedule?.slots?.length > 0) {
            let slotDates
            if (weekStart) {
              slotDates = getAvailableSlots(platSchedule, weekStart)
            } else {
              slotDates = platSchedule.slots
                .map(s => ({ ...s, date: getNextSlotDate(s.day, s.time) }))
                .filter(s => s.date && s.date > new Date())
                .sort((a, b) => a.date - b.date)
            }

            const targetDate = slotDates[0]?.date || new Date(Date.now() + 3600000)
            scheduledTimes[basePlatform] = targetDate
            const result = await api.schedulePosts([post], targetDate.toISOString())
            totalScheduled += result.scheduled?.length || 0
          } else {
            const fallback = weekStart ? new Date(weekStart.getTime() + 2 * 86400000 + 11 * 3600000) : new Date(Date.now() + 3600000)
            scheduledTimes[basePlatform] = fallback
            const result = await api.schedulePosts([post], fallback.toISOString())
            totalScheduled += result.scheduled?.length || 0
          }
        }
        const weekLabel = weekStart ? ` for ${formatWeekRange(weekStart)}` : ' at suggested times'
        setScheduleStatus(`Scheduled ${totalScheduled} posts${weekLabel}`)
      } else {
        if (!scheduleDate) { setScheduling(false); return }
        const feedPosts = posts.filter(p => !p._story_offset)
        const storyPosts = posts.filter(p => p._story_offset)
        const baseTime = new Date(scheduleDate)
        const result = await api.schedulePosts(feedPosts, baseTime.toISOString())
        let storyCount = 0
        if (storyPosts.length > 0) {
          const storyTime = new Date(baseTime.getTime() + 45 * 60 * 1000)
          const storyResult = await api.schedulePosts(storyPosts, storyTime.toISOString())
          storyCount = storyResult.scheduled?.length || 0
        }
        setScheduleStatus(`Scheduled ${result.scheduled.length + storyCount} posts${storyCount ? ` (${storyCount} stories +45min)` : ''}`)
      }
      setShowSchedule(false)
      setScheduleDate('')
      setTimeout(() => setScheduleStatus(''), 4000)
    } catch (err) {
      setScheduleStatus('Failed: ' + err.message)
      setTimeout(() => setScheduleStatus(''), 5000)
    }
    setScheduling(false)
  }

  const hasResults = Object.keys(results).length > 0

  return (
    <div className="px-3.5 py-2 border-b border-border bg-[#f9f8f6]">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handlePostAll}
          disabled={posting || scheduling}
          className="text-[11px] py-1.5 px-3 rounded-sm bg-[#2D9A5E] text-white cursor-pointer font-sans font-medium hover:bg-[#248a50] disabled:opacity-50 border-none"
        >
          {posting ? 'Posting...' : `Post All (${postable.length})`}
        </button>
        <button
          onClick={() => targetWeek ? handleScheduleAll() : setShowSchedule(!showSchedule)}
          disabled={posting || scheduling}
          className="text-[11px] py-1.5 px-3 rounded-sm bg-[#6C5CE7] text-white cursor-pointer font-sans font-medium hover:bg-[#5a4bd6] disabled:opacity-50 border-none"
        >
          {scheduling ? 'Scheduling...' : targetWeek ? `Schedule for ${formatWeekRange(getWeekStart(targetWeek))}` : 'Schedule'}
        </button>
        {postable.some(p => p.key === 'blog') && (
          <>
            {wpCategories.length > 0 && (
              <select
                multiple
                value={selectedCats.map(String)}
                onChange={e => setSelectedCats(Array.from(e.target.selectedOptions, o => Number(o.value)))}
                className="text-[10px] border border-border rounded-sm bg-white px-1 py-0.5 max-h-[50px] min-w-[80px]"
                title="Hold Ctrl/Cmd to select categories"
              >
                {wpCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-1 text-[10px] text-muted cursor-pointer select-none">
              <input type="checkbox" checked={wpPublishAll} onChange={e => setWpPublishAll(e.target.checked)} className="accent-[#21759B]" />
              WP: {wpPublishAll ? 'Publish' : 'Draft'}
            </label>
          </>
        )}
        {scheduleStatus && (
          <span className={`text-[10px] ${scheduleStatus.startsWith('Failed') ? 'text-[#c0392b]' : 'text-[#6C5CE7]'}`}>{scheduleStatus}</span>
        )}
        {hasResults && postable.map(p => {
          const r = results[p.key]
          if (!r) return posting ? <span key={p.key} className="text-[10px] text-muted">{PLATFORM_LABELS[p.key]}: waiting...</span> : null
          const isOk = r === 'success' || r === 'draft'
          return (
            <span key={p.key} className={`text-[10px] ${isOk ? 'text-[#2D9A5E]' : 'text-[#c0392b]'}`}>
              <span className="font-medium" style={{ color: PLATFORM_COLORS[p.key] }}>{PLATFORM_LABELS[p.key]}:</span>{' '}
              {r === 'success' ? 'Posted' : r === 'draft' ? 'Draft saved' : r}
            </span>
          )
        })}
      </div>
      {showSchedule && (
        <div className="mt-2 space-y-2">
          {settings?.posting_schedule?.schedule && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-ink cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useSuggestedTimes}
                  onChange={e => setUseSuggestedTimes(e.target.checked)}
                  className="accent-[#6C5CE7]"
                />
                Post at suggested times for each platform
              </label>
              {useSuggestedTimes && (
                <div className="bg-[#f3f0ff] rounded px-2.5 py-1.5 space-y-0.5">
                  {postable.map(p => {
                    const schedule = settings.posting_schedule.schedule
                    const weekStart = targetWeek ? getWeekStart(targetWeek) : null
                    const platSched = schedule.find(s =>
                      s.platform.toLowerCase().includes(p.key) || p.key.includes(s.platform.toLowerCase())
                    )
                    let slotDate = null, slotLabel = ''
                    if (platSched?.slots?.length > 0) {
                      if (weekStart) {
                        const slots = getAvailableSlots(platSched, weekStart)
                        if (slots[0]?.date) { slotDate = slots[0].date }
                      } else {
                        const slots = platSched.slots
                          .map(s => ({ ...s, date: getNextSlotDate(s.day, s.time) }))
                          .filter(s => s.date && s.date > new Date())
                          .sort((a, b) => a.date - b.date)
                        if (slots[0]?.date) { slotDate = slots[0].date }
                      }
                    }
                    if (slotDate) {
                      slotLabel = slotDate.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                    } else {
                      slotLabel = 'No slot available'
                    }
                    return (
                      <div key={p.key} className="flex items-center gap-2 text-[10px]">
                        <span className="font-medium min-w-[65px]" style={{ color: PLATFORM_COLORS[p.key] }}>{PLATFORM_LABELS[p.key]}</span>
                        <span className="text-ink">{slotLabel}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
          {/* Include stories option */}
          {postable.some(p => p.key === 'facebook' || p.key === 'instagram') && item.isImg && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-ink cursor-pointer select-none">
                <input type="checkbox" checked={includeStories} onChange={e => setIncludeStories(e.target.checked)} className="accent-[#E1306C]" />
                Include stories (+45min after feed post)
              </label>
              {includeStories && (
                <div className="bg-[#fef3f8] rounded px-2.5 py-1.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted min-w-[50px]">Caption:</span>
                    <select value={schedStoryCaptionStyle} onChange={e => setSchedStoryCaptionStyle(e.target.value)} className="text-[10px] border border-border rounded px-1 py-0.5 bg-white">
                      <option value="none">No overlay</option>
                      <option value="overlay">Text overlay</option>
                    </select>
                  </div>
                  {schedStoryCaptionStyle === 'overlay' && (
                    <>
                      <textarea
                        rows={2}
                        value={schedStoryText}
                        onChange={e => setSchedStoryText(e.target.value)}
                        placeholder="Story overlay text..."
                        className="w-full text-[10px] border border-border rounded px-2 py-1 bg-white resize-y"
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-[9px] text-muted">Position:
                          <input type="range" min={10} max={90} value={schedOverlayYPct} onChange={e => setSchedOverlayYPct(Number(e.target.value))} className="w-16 ml-1 align-middle" />
                        </label>
                        <label className="text-[9px] text-muted">Size:
                          <select value={schedStoryFontSize} onChange={e => setSchedStoryFontSize(Number(e.target.value))} className="text-[9px] border border-border rounded px-1 bg-white ml-1">
                            <option value={32}>Small</option><option value={48}>Medium</option><option value={64}>Large</option><option value={80}>XXXL</option>
                          </select>
                        </label>
                        <label className="text-[9px] text-muted">Color:
                          <input type="color" value={schedStoryFontColor} onChange={e => setSchedStoryFontColor(e.target.value)} className="w-5 h-4 ml-1 align-middle border-none" />
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {!useSuggestedTimes && (
              <input
                type="datetime-local"
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
                min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                className="text-xs border border-border rounded px-2 py-1 bg-white"
              />
            )}
            <button
              onClick={handleScheduleAll}
              disabled={scheduling || (!useSuggestedTimes && !scheduleDate)}
              className="text-[11px] py-1 px-2.5 rounded-sm bg-[#6C5CE7] text-white cursor-pointer font-sans hover:bg-[#5a4bd6] disabled:opacity-50 border-none"
            >
              {scheduling ? 'Scheduling...' : useSuggestedTimes ? `Schedule at best times (${postable.length})` : `Schedule All (${postable.length})`}
            </button>
            <button
              onClick={() => { setShowSchedule(false); setScheduleDate(''); setUseSuggestedTimes(false) }}
              className="text-[10px] text-muted hover:underline"
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function CaptionEditor({ text, blogTitle, ytTags, captionId, score, platform, item, settings, apiUrl, onSave, onRegen, onRefine }) {
  const [value, setValue] = useState(text)
  const [title, setTitle] = useState(blogTitle || '')
  const [tags, setTags] = useState(ytTags || [])
  const [saved, setSaved] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postStatus, setPostStatus] = useState('')
  const [storyEnabled, setStoryEnabled] = useState(settings?.fb_stories_default === true)
  const [storyCaptionStyle, setStoryCaptionStyle] = useState('none')
  const [storyPreview, setStoryPreview] = useState(null)
  const [overlayYPct, setOverlayYPct] = useState(70)
  const [storyText, setStoryText] = useState('')
  const [storyFontSize, setStoryFontSize] = useState(48)
  const [storyFontFamily, setStoryFontFamily] = useState('sans-serif')
  const [storyFontColor, setStoryFontColor] = useState('#ffffff')
  const [storyFontOutline, setStoryFontOutline] = useState(false)
  const [openingText, setOpeningText] = useState('')
  const [closingText, setClosingText] = useState('')
  const [openingDuration, setOpeningDuration] = useState(3)
  const [closingDuration, setClosingDuration] = useState(3)
  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState(null)
  const [generatingPreview, setGeneratingPreview] = useState(false)
  const [videoSrc] = useState(() => item.file ? URL.createObjectURL(item.file) : item.url || '')

  // Sync when text prop changes (e.g. after refine/regen)
  useEffect(() => { setValue(text) }, [text])
  useEffect(() => { setTitle(blogTitle || '') }, [blogTitle])
  useEffect(() => { setTags(ytTags || []) }, [ytTags])

  // Init story text from first sentence of caption
  useEffect(() => {
    if (storyCaptionStyle === 'overlay' && !storyText && value) {
      const first = value.split(/[.!?]\s/)[0].replace(/[.!?]$/, '').trim()
      if (first) setStoryText(first)
    }
  }, [storyCaptionStyle, value])

  // Generate story preview when enabled (images only — videos use inline player)
  const isVideoFile = item.file?.type?.startsWith('video/')
  const videoPreviewRef = useRef(null)
  const [videoTime, setVideoTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)

  useEffect(() => {
    if (!storyEnabled || !item.isImg) { setStoryPreview(null); return }
    let cancelled = false
    import('../lib/crop').then(({ smartCrop, STORY_RATIO }) => {
    return smartCrop(item, STORY_RATIO || { w: 1080, h: 1920 }).then(blob => {
      if (cancelled) return
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 1080; canvas.height = 1920
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, 1080, 1920)

        if (storyCaptionStyle === 'overlay' && storyText) {
          const SAFE_TOP = Math.round(1920 * 0.15)
          const SAFE_BOTTOM = Math.round(1920 * 0.85)

          const charsPerLine = Math.max(15, Math.round(40 * (48 / storyFontSize)))
          const words = storyText.split(' ')
          const lines = []
          let line = ''
          for (const w of words) {
            if ((line + ' ' + w).trim().length > charsPerLine && line) { lines.push(line.trim()); line = w }
            else line = (line + ' ' + w).trim()
          }
          if (line) lines.push(line.trim())

          const lineH = storyFontSize * 1.4
          const blockH = lines.length * lineH + 40

          const maxTop = SAFE_BOTTOM - blockH - 20
          const minTop = SAFE_TOP + 20
          const gradTop = Math.round(minTop + ((maxTop - minTop) * overlayYPct / 100))
          const gradH = blockH + 40

          const grad = ctx.createLinearGradient(0, gradTop - 20, 0, gradTop + gradH + 20)
          grad.addColorStop(0, 'rgba(0,0,0,0)')
          grad.addColorStop(0.15, 'rgba(0,0,0,0.55)')
          grad.addColorStop(0.85, 'rgba(0,0,0,0.55)')
          grad.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.fillStyle = grad
          ctx.fillRect(0, gradTop - 20, 1080, gradH + 40)

          ctx.font = `600 ${storyFontSize}px ${storyFontFamily}`
          ctx.fillStyle = storyFontColor
          ctx.textAlign = 'center'
          if (storyFontOutline) {
            ctx.strokeStyle = 'black'; ctx.lineWidth = 4; ctx.lineJoin = 'round'
            lines.forEach((l, i) => ctx.strokeText(l, 540, gradTop + 20 + (i * lineH) + storyFontSize))
          } else {
            ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2
          }
          lines.forEach((l, i) => ctx.fillText(l, 540, gradTop + 20 + (i * lineH) + storyFontSize))

          ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
          ctx.setLineDash([8, 8])
          ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(0, SAFE_TOP); ctx.lineTo(1080, SAFE_TOP); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(0, SAFE_BOTTOM); ctx.lineTo(1080, SAFE_BOTTOM); ctx.stroke()
          ctx.setLineDash([])
        }

        canvas.toBlob(b => {
          if (!cancelled) setStoryPreview(URL.createObjectURL(b))
        }, 'image/jpeg', 0.8)
      }
      img.src = URL.createObjectURL(blob)
    })}).catch(() => {})
    return () => { cancelled = true }
  }, [storyEnabled, storyCaptionStyle, storyText, item, overlayYPct, storyFontSize, storyFontFamily, storyFontColor, storyFontOutline])

  // Helper: calculate overlay opacity based on current video time
  const getOverlayOpacity = (currentTime, startTime, duration, fadeTime = 0.5) => {
    const endTime = startTime + duration
    if (currentTime < startTime || currentTime > endTime) return 0
    if (currentTime < startTime + fadeTime) return (currentTime - startTime) / fadeTime
    if (currentTime > endTime - fadeTime) return (endTime - currentTime) / fadeTime
    return 1
  }

  const CHAR_LIMITS = { twitter: 280, instagram: 2200, tiktok: 4000, google: 750 }
  const charLimit = CHAR_LIMITS[platform] || null

  const handleBlur = () => {
    if (value !== text) {
      onSave(value)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  const canPostFb = platform === 'facebook' && settings?.fb_connected
  const canPostIg = platform === 'instagram' && settings?.ig_connected
  const canPostTw = platform === 'twitter' && settings?.twitter_connected
  const canPostGoogle = platform === 'google' && settings?.google_connected
  const canPostPinterest = platform === 'pinterest' && settings?.pinterest_connected
  const canPostWp = platform === 'blog' && settings?.wp_site_url
  const canPostTk = platform === 'tiktok' && settings?.tiktok_connected
  const isVideo = item.file?.type?.startsWith('video/')
  const canPostYt = platform === 'youtube' && settings?.youtube_connected && isVideo
  const isTiktok = platform === 'tiktok'
  const [wpCategories, setWpCategories] = useState([])
  const [selectedCats, setSelectedCats] = useState([])
  const [googlePostEnabled, setGooglePostEnabled] = useState(true)
  const [googleGalleryEnabled, setGoogleGalleryEnabled] = useState(true)
  const [wpCatsLoaded, setWpCatsLoaded] = useState(false)
  const [wpPublish, setWpPublish] = useState(false)

  useEffect(() => {
    if (canPostWp && !wpCatsLoaded) {
      import('../api').then(api => api.getWpCategories()).then(cats => {
        if (Array.isArray(cats)) setWpCategories(cats)
        setWpCatsLoaded(true)
      }).catch(() => setWpCatsLoaded(true))
    }
  }, [canPostWp, wpCatsLoaded])

  // fileToBase64 is defined at module level

  const getImageBase64 = async (targetPlatform) => {
    if (!item.file) return { imageBase64: null, mediaType: null }

    const isStory = targetPlatform === 'instagram_story' || targetPlatform === 'facebook_story'
    const isVideo = item.file.type && item.file.type.startsWith('video/')

    // For videos, use ArrayBuffer approach (iOS Safari fails with readAsDataURL on large files)
    if (isVideo) {
      const imageBase64 = await fileToBase64(item.file)
      return { imageBase64, mediaType: item.file.type }
    }

    if (!item.isImg && !item.file?.type?.startsWith('image/')) return { imageBase64: null, mediaType: null }

    const cropRatio = PLATFORM_CROPS[targetPlatform]
    if (cropRatio) {
      // Smart crop with face detection, then apply watermark
      let blob = await smartCrop(item, cropRatio)
      blob = await applyWatermark(blob, cropRatio.wm, apiUrl)
      const imageBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result.split(',')[1])
        r.onerror = reject
        r.readAsDataURL(blob)
      })
      return { imageBase64, mediaType: 'image/jpeg' }
    }
    // Fallback: raw file
    const imageBase64 = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result.split(',')[1])
      r.onerror = reject
      r.readAsDataURL(item.file)
    })
    return { imageBase64, mediaType: item.file.type || 'image/jpeg' }
  }

  const handlePost = async (target, opts = {}) => {
    setPosting(true)
    setPostStatus('')
    try {
      const { imageBase64, mediaType } = await getImageBase64(target)
      const api = await import('../api')
      if (target === 'facebook') {
        await api.postToFacebook(value, imageBase64, mediaType)
        setPostStatus('Posted!')
      } else if (target === 'facebook_story' || target === 'instagram_story') {
        if (!imageBase64) throw new Error('Stories require media')
        const hasOverlays = storyCaptionStyle === 'overlay' && (openingText || closingText || storyText)
        if (hasOverlays && !generatedPreviewUrl) {
          if (!confirm('You have text overlays but haven\'t previewed. The overlays will be burned into the video. Post anyway?')) {
            setPosting(false); return
          }
        }
        const storyCaption = storyCaptionStyle === 'overlay' ? storyText : value
        const fontOpts = { fontSize: storyFontSize, fontFamily: storyFontFamily, fontColor: storyFontColor, fontOutline: storyFontOutline, openingText, closingText, openingDuration, closingDuration }
        if (target === 'facebook_story') {
          await api.postToFacebookStory(storyCaption, imageBase64, mediaType, storyCaptionStyle, overlayYPct, fontOpts)
          setPostStatus('FB Story posted!')
        } else {
          await api.postToInstagramStory(storyCaption, imageBase64, mediaType, storyCaptionStyle, overlayYPct, fontOpts)
          setPostStatus('Story posted!')
        }
      } else if (target === 'instagram') {
        if (!imageBase64) throw new Error('Instagram requires a photo')
        await api.postToInstagram(value, imageBase64, mediaType)
        setPostStatus('Posted!')
      } else if (target === 'twitter') {
        const result = await api.postToTwitter(value, imageBase64, mediaType)
        if (result.warning) {
          setPostStatus('Warning: ' + result.warning)
        } else {
          setPostStatus('Posted to X!')
        }
        if (result.tweet_url) window.open(result.tweet_url, '_blank')
      } else if (target === 'tiktok') {
        const result = await api.postToTiktok(value, imageBase64, mediaType)
        if (result.fallback) {
          // API not enabled or not approved -- copy to clipboard as fallback
          navigator.clipboard.writeText(value)
          setPostStatus(result.message || 'Caption copied — post manually on TikTok')
        } else {
          setPostStatus('Posted to TikTok!')
        }
      } else if (target === 'google') {
        const results = []
        if (opts.googlePost) {
          try {
            await api.postToGoogle(value, imageBase64, mediaType, { type: 'post' })
            results.push('Post created')
          } catch (e) { results.push('Post failed: ' + e.message) }
        }
        if (opts.googleGallery) {
          try {
            await api.postToGoogle(value, imageBase64, mediaType, { type: 'gallery' })
            results.push('Photo added to gallery')
          } catch (e) { results.push('Gallery failed: ' + e.message) }
        }
        setPostStatus(results.join(' | ') || 'Posted to Google!')
      } else if (target === 'youtube') {
        if (!imageBase64) throw new Error('YouTube Shorts requires a video')
        const ytCaption = JSON.stringify({ title: title || item.name || 'Short', description: value, tags })
        await api.postToYoutubeShorts(ytCaption, imageBase64, mediaType)
        setPostStatus('Uploaded to YouTube Shorts!')
      } else if (target === 'pinterest') {
        if (!imageBase64) throw new Error('Pinterest requires an image')
        await api.postToPinterest(value, imageBase64, mediaType)
        setPostStatus('Pinned!')
      } else if (target === 'wordpress') {
        const wpTitle = title || item.name || item.file?.name?.replace(/\.[^.]+$/, '') || 'New Post'
        const result = await api.postToWordPress(wpTitle, value, imageBase64, mediaType, selectedCats, wpPublish)
        if (wpPublish) {
          setPostStatus('Published to WordPress!')
        } else {
          setPostStatus('Draft created — review in WP admin')
        }
        if (result.edit_url) window.open(result.edit_url, '_blank')
      } else {
        setPostStatus('Posted!')
      }
      setTimeout(() => setPostStatus(''), 3000)
    } catch (err) {
      setPostStatus('Failed: ' + err.message)
      setTimeout(() => setPostStatus(''), 5000)
    }
    setPosting(false)
  }

  const scoreLabel = score?.score >= 0
    ? (score.score <= 30 ? 'Human' : score.score <= 60 ? 'Mixed' : 'AI-like')
    : null

  return (
    <>
      {(platform === 'blog' || platform === 'youtube') && (
        <>
          <input
            className={`w-full text-xs font-medium text-ink border rounded-sm py-1.5 px-2 font-sans bg-transparent transition-all hover:border-border focus:outline-none focus:border-sage focus:bg-white mb-1 ${platform === 'youtube' && title.length > 100 ? 'border-[#c0392b]' : 'border-transparent'}`}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={platform === 'youtube' ? 'Video title...' : 'Blog post title...'}
          />
          {platform === 'youtube' && (
            <div className={`text-[10px] text-right -mt-0.5 mb-1 ${title.length > 100 ? 'text-[#c0392b] font-medium' : 'text-muted'}`}>
              {title.length}/100{title.length > 100 ? ` (${title.length - 100} over)` : ''}
            </div>
          )}
        </>
      )}
      <textarea
        className={`w-full text-xs md:text-xs text-[14px] leading-relaxed whitespace-pre-wrap text-ink border rounded-sm py-2 md:py-1.5 px-3 md:px-2 font-sans resize-y min-h-[80px] md:min-h-[60px] bg-transparent transition-all hover:border-border focus:outline-none focus:border-sage focus:bg-white select-text ${charLimit && value.length > charLimit ? 'border-[#c0392b]' : 'border-transparent'}`}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleBlur}
        rows={Math.max(3, Math.ceil(value.length / 60))}
        style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
      />
      {charLimit && (
        <div className={`text-[10px] text-right mt-0.5 ${value.length > charLimit ? 'text-[#c0392b] font-medium' : 'text-muted'}`}>
          {value.length}/{charLimit}{value.length > charLimit ? ` (${value.length - charLimit} over)` : ''}
        </div>
      )}
      {platform === 'youtube' && tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 items-center">
          <span className="text-[10px] text-muted mr-0.5">Tags:</span>
          {tags.map((t, i) => (
            <span key={i} className="inline-block bg-[#ffecec] text-[#cc0000] border border-[#ffcccc] rounded-full px-[7px] text-[10px]">{t}</span>
          ))}
          <button
            onClick={() => navigator.clipboard.writeText(tags.join(', '))}
            className="text-[10px] text-muted hover:underline ml-1"
          >Copy tags</button>
        </div>
      )}
      {/* Mobile: full-width copy button */}
      <button
        onClick={() => { navigator.clipboard.writeText(value); setPostStatus('Copied!'); setTimeout(() => setPostStatus(''), 2000) }}
        className="md:hidden w-full py-3 text-[14px] font-medium border border-sage rounded-sm bg-sage-light text-sage cursor-pointer font-sans active:bg-sage active:text-white min-h-[48px] mt-2"
      >
        {postStatus === 'Copied!' ? 'Copied!' : 'Copy Caption'}
      </button>
      <div className="flex justify-end gap-1.5 mt-2 items-center flex-wrap">
        {platform === 'youtube' && (
          <button
            onClick={() => {
              const full = `${title}\n\n${value}${tags.length ? '\n\nTags: ' + tags.join(', ') : ''}`
              navigator.clipboard.writeText(full)
            }}
            className="text-[11px] py-1 px-2.5 border border-[#FF0000] rounded-sm bg-[#FF0000] text-white cursor-pointer font-sans hover:bg-[#cc0000]"
          >Copy All for YouTube</button>
        )}
        {canPostFb && (
          <>
            <button
              onClick={() => handlePost('facebook')}
              disabled={posting}
              className="text-[11px] py-1 px-2.5 border border-[#1877F2] rounded-sm bg-[#1877F2] text-white cursor-pointer font-sans hover:bg-[#1565c0] disabled:opacity-50"
            >
              {posting ? 'Posting...' : 'Post to Facebook'}
            </button>
            <button
              onClick={() => handlePost('facebook_story')}
              disabled={posting || !storyEnabled}
              className={`text-[11px] py-1 px-2.5 border rounded-sm cursor-pointer font-sans disabled:opacity-50 ${storyEnabled ? 'border-[#1877F2] bg-[#4267B2] text-white hover:bg-[#365899]' : 'border-[#ddd] bg-white text-muted'}`}
            >
              {posting ? 'Posting...' : 'FB Story'}
            </button>
          </>
        )}
        {canPostIg && (
          <>
            <button
              onClick={() => handlePost('instagram')}
              disabled={posting}
              className="text-[11px] py-1 px-2.5 border border-[#E1306C] rounded-sm bg-[#E1306C] text-white cursor-pointer font-sans hover:bg-[#c1255b] disabled:opacity-50"
            >
              {posting ? 'Posting...' : 'Post to Instagram'}
            </button>
            <button
              onClick={() => handlePost('instagram_story')}
              disabled={posting || !storyEnabled}
              className={`text-[11px] py-1 px-2.5 border rounded-sm cursor-pointer font-sans disabled:opacity-50 ${storyEnabled ? 'border-[#833AB4] bg-[#833AB4] text-white hover:bg-[#6d2e96]' : 'border-[#ddd] bg-white text-muted'}`}
            >
              {posting ? 'Posting...' : 'Post Story'}
            </button>
          </>
        )}
        {(canPostFb || canPostIg) && (
          <div className="w-full flex flex-col gap-1 mt-1 border-t border-border pt-1.5">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={storyEnabled} onChange={e => setStoryEnabled(e.target.checked)} />
              <span>Stories {canPostFb && canPostIg ? '(FB + IG)' : canPostFb ? '(Facebook)' : '(Instagram)'}</span>
            </label>
            {storyEnabled && (
              <>
                <div className="flex gap-3 ml-5 text-[10px]">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name={`story-style-${item.id}`} value="none" checked={storyCaptionStyle === 'none'} onChange={() => setStoryCaptionStyle('none')} />
                    No caption (visual only)
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name={`story-style-${item.id}`} value="overlay" checked={storyCaptionStyle === 'overlay'} onChange={() => setStoryCaptionStyle('overlay')} />
                    Text overlay on image
                  </label>
                </div>
                {(storyPreview || (storyEnabled && isVideoFile)) && (
                  <div className="ml-5 mt-1.5">
                    <p className="text-[10px] text-muted mb-1">Story preview {!isVideoFile && <span className="text-[9px]">(dashed lines = safe zone)</span>}</p>
                    {isVideoFile ? (
                      <div>
                        {/* Live preview with CSS overlays OR generated preview */}
                        <div className="flex gap-1">
                          {/* 9:16 preview — matches 1080x1920 story output */}
                          <div className="relative rounded border border-border overflow-hidden bg-black flex-shrink-0" style={{ width: 120, height: Math.round(120 / 9 * 16) }}>
                            {generatedPreviewUrl ? (
                              <video
                                src={generatedPreviewUrl}
                                className="w-full h-full object-contain"
                                controls
                                muted
                                autoPlay
                                loop
                                playsInline
                              />
                            ) : (
                              <>
                                <video
                                  ref={videoPreviewRef}
                                  src={videoSrc}
                                  className="w-full h-full object-cover"
                                  style={{ objectPosition: 'center 33%' }}
                                  muted
                                  loop
                                  playsInline
                                  onTimeUpdate={e => setVideoTime(e.target.currentTime)}
                                  onLoadedMetadata={e => setVideoDuration(e.target.duration)}
                                />
                                {/* Safe zone guides */}
                                <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '15%', borderTop: '1px dashed rgba(255,255,255,0.4)' }} />
                                <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '85%', borderTop: '1px dashed rgba(255,255,255,0.4)' }} />
                                {/* Live CSS text overlay — scaled to match ffmpeg output */}
                                {storyCaptionStyle === 'overlay' && (() => {
                                  const SCALE = 120 / 1080 // preview px / output px
                                  const hasTimedOverlays = openingText || closingText
                                  const closingStart = Math.max(0, videoDuration - closingDuration)
                                  const showOpening = hasTimedOverlays && openingText && videoTime >= 0 && videoTime <= openingDuration
                                  const showClosing = hasTimedOverlays && closingText && videoDuration > 0 && videoTime >= closingStart
                                  const showFull = !hasTimedOverlays && storyText
                                  const displayText = showOpening ? openingText : showClosing ? closingText : showFull ? storyText : null
                                  if (!displayText) return null
                                  // Match ffmpeg's position math exactly:
                                  // safeTop = H * 0.15, safeBottom = H * 0.85
                                  // textBlockH = fontSize * 2.5
                                  // maxY = safeBottom - textBlockH, minY = safeTop
                                  // yPos = minY + ((maxY - minY) * overlayYPct / 100)
                                  // text drawn at yPos + 10
                                  const previewH = Math.round(120 / 9 * 16)
                                  const scaledFontSize = Math.max(5, Math.round(storyFontSize * SCALE))
                                  const safeTopPx = Math.round(previewH * 0.15)
                                  const safeBottomPx = Math.round(previewH * 0.85)
                                  const textBlockPx = scaledFontSize * 2.5
                                  const maxYPx = safeBottomPx - textBlockPx
                                  const minYPx = safeTopPx
                                  const yPosPx = Math.round(minYPx + ((maxYPx - minYPx) * overlayYPct / 100)) + Math.round(10 * SCALE)
                                  const scaledBorderW = Math.max(0.3, 3 * SCALE)
                                  return (
                                    <div className="absolute left-0 right-0 pointer-events-none flex flex-col items-center px-0.5" style={{ top: `${yPosPx}px` }}>
                                      {!storyFontOutline && <div className="absolute inset-0 bg-black/50 rounded-sm" style={{ margin: `${-2 * SCALE}px ${-4 * SCALE}px` }} />}
                                      <span className="relative text-center leading-tight" style={{
                                        fontSize: `${scaledFontSize}px`,
                                        fontFamily: storyFontFamily,
                                        color: storyFontColor,
                                        fontWeight: 600,
                                        ...(storyFontOutline
                                          ? { WebkitTextStroke: `${scaledBorderW}px black`, paintOrder: 'stroke fill' }
                                          : { textShadow: `0 ${Math.round(2 * SCALE)}px ${Math.round(4 * SCALE)}px rgba(0,0,0,0.7)` }),
                                      }}>{displayText}</span>
                                    </div>
                                  )
                                })()}
                                {/* Play controls */}
                                <div className="absolute bottom-1 left-1 right-1 flex items-center gap-0.5">
                                  <button onClick={() => { const v = videoPreviewRef.current; if (v) { v.currentTime = Math.max(0, v.currentTime - 2) } }} className="text-white text-[8px] bg-black/60 rounded px-1 py-0.5 cursor-pointer">&lt;</button>
                                  <button onClick={() => { const v = videoPreviewRef.current; if (v) v.paused ? v.play() : v.pause() }} className="text-white text-[8px] bg-black/60 rounded px-1.5 py-0.5 cursor-pointer">{videoPreviewRef.current?.paused !== false ? '\u25B6' : '\u23F8'}</button>
                                  <button onClick={() => { const v = videoPreviewRef.current; if (v) { v.currentTime = Math.min(v.duration || 0, v.currentTime + 2) } }} className="text-white text-[8px] bg-black/60 rounded px-1 py-0.5 cursor-pointer">&gt;</button>
                                  <span className="text-white text-[7px] bg-black/60 rounded px-1 py-0.5 ml-auto">{videoTime.toFixed(1)}s</span>
                                </div>
                              </>
                            )}
                          </div>
                          {/* Vertical slider for overlay position */}
                          {storyCaptionStyle === 'overlay' && !generatedPreviewUrl && (
                            <div className="flex flex-col items-center" style={{ height: Math.round(120 / 9 * 16), paddingTop: `${Math.round(120 / 9 * 16) * 0.15}px`, paddingBottom: `${Math.round(120 / 9 * 16) * 0.15}px` }}>
                              <input
                                type="range"
                                min="0" max="100"
                                value={overlayYPct}
                                onChange={e => setOverlayYPct(Number(e.target.value))}
                                className="h-full cursor-pointer"
                                style={{ writingMode: 'vertical-lr', direction: 'ltr', width: 14 }}
                              />
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 mt-1.5">
                          {generatedPreviewUrl && (
                            <button
                              onClick={() => { URL.revokeObjectURL(generatedPreviewUrl); setGeneratedPreviewUrl(null) }}
                              className="text-[10px] py-1 px-2 border border-border text-muted rounded cursor-pointer"
                            >Back to edit</button>
                          )}
                          <button
                            onClick={async () => {
                              setGeneratingPreview(true)
                              try {
                                const { imageBase64, mediaType } = await getImageBase64('facebook_story')
                                const api = await import('../api')
                                const url = await api.previewStory(
                                  storyCaptionStyle === 'overlay' ? (storyText || value) : value,
                                  imageBase64, mediaType, storyCaptionStyle, overlayYPct,
                                  { fontSize: storyFontSize, fontFamily: storyFontFamily, fontColor: storyFontColor, fontOutline: storyFontOutline, openingText, closingText, openingDuration, closingDuration }
                                )
                                if (generatedPreviewUrl) URL.revokeObjectURL(generatedPreviewUrl)
                                setGeneratedPreviewUrl(url)
                              } catch (err) { console.error(err); alert('Preview failed: ' + err.message) }
                              setGeneratingPreview(false)
                            }}
                            disabled={generatingPreview}
                            className="text-[10px] py-1 px-2 border border-[#2D9A5E] text-[#2D9A5E] rounded cursor-pointer disabled:opacity-50"
                          >
                            {generatingPreview ? 'Generating...' : generatedPreviewUrl ? 'Regenerate' : 'Generate Preview'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={storyPreview}
                        className="w-[120px] h-[213px] object-cover rounded border border-border cursor-ns-resize"
                        alt="Story preview"
                        draggable={false}
                        onMouseDown={e => {
                          if (storyCaptionStyle !== 'overlay') return
                          const rect = e.currentTarget.getBoundingClientRect()
                          const startY = e.clientY
                          const startPct = overlayYPct
                          const onMove = (ev) => {
                            const dy = ev.clientY - startY
                            const pctDelta = (dy / rect.height) * 100
                            setOverlayYPct(Math.max(0, Math.min(100, startPct + pctDelta)))
                          }
                          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
                          document.addEventListener('mousemove', onMove)
                          document.addEventListener('mouseup', onUp)
                        }}
                      />
                    )}
                    {storyCaptionStyle === 'overlay' && (
                      <div className="mt-1.5 space-y-1.5">
                        <textarea
                          className="w-full text-[11px] border border-border rounded p-1.5 font-sans resize-none bg-white"
                          rows={2}
                          value={storyText}
                          onChange={e => setStoryText(e.target.value)}
                          placeholder="Full overlay text (shown entire video if no opening/closing set)..."
                        />
                        {item.file?.type?.startsWith('video/') && (
                          <div className="space-y-1 border border-border rounded p-1.5 bg-[#fafafa]">
                            <p className="text-[9px] text-muted font-medium">Video overlays (fade in/out)</p>
                            <div className="flex gap-1.5">
                              <div className="flex-1">
                                <input className="w-full text-[10px] border border-border rounded py-0.5 px-1 bg-white" value={openingText} onChange={e => setOpeningText(e.target.value)} placeholder="Opening text..." />
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="text-[9px] text-muted">Duration:</span>
                                  <select className="text-[9px] border border-border rounded py-0 px-0.5 bg-white" value={openingDuration} onChange={e => setOpeningDuration(Number(e.target.value))}>
                                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}s</option>)}
                                  </select>
                                </div>
                              </div>
                              <div className="flex-1">
                                <input className="w-full text-[10px] border border-border rounded py-0.5 px-1 bg-white" value={closingText} onChange={e => setClosingText(e.target.value)} placeholder="Closing text..." />
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="text-[9px] text-muted">Duration:</span>
                                  <select className="text-[9px] border border-border rounded py-0 px-0.5 bg-white" value={closingDuration} onChange={e => setClosingDuration(Number(e.target.value))}>
                                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}s</option>)}
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <select className="text-[10px] border border-border rounded py-0.5 px-1 bg-white" value={storyFontFamily} onChange={e => setStoryFontFamily(e.target.value)}>
                            <option value="sans-serif">Sans Serif</option>
                            <option value="serif">Serif</option>
                            <option value="Georgia, serif">Georgia</option>
                            <option value="'Courier New', monospace">Mono</option>
                            <option value="'Comic Sans MS', cursive">Casual</option>
                            <option value="Impact, sans-serif">Impact</option>
                          </select>
                          <select className="text-[10px] border border-border rounded py-0.5 px-1 bg-white" value={storyFontSize} onChange={e => setStoryFontSize(Number(e.target.value))}>
                            <option value={32}>Small</option>
                            <option value={40}>Medium</option>
                            <option value={48}>Large</option>
                            <option value={56}>XL</option>
                            <option value={64}>XXL</option>
                            <option value={80}>XXXL</option>
                          </select>
                          <input type="color" value={storyFontColor} onChange={e => setStoryFontColor(e.target.value)} className="w-5 h-5 border border-border rounded cursor-pointer p-0" title="Text color" />
                          <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                            <input type="checkbox" checked={storyFontOutline} onChange={e => setStoryFontOutline(e.target.checked)} />
                            Outline
                          </label>
                        </div>
                        {!isVideoFile && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-muted">Top</span>
                            <input type="range" min="0" max="100" value={overlayYPct} onChange={e => setOverlayYPct(Number(e.target.value))} className="flex-1 h-1" />
                            <span className="text-[9px] text-muted">Bottom</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {canPostTw && (
          <button
            onClick={() => handlePost('twitter')}
            disabled={posting}
            className="text-[11px] py-1 px-2.5 border border-black rounded-sm bg-black text-white cursor-pointer font-sans hover:bg-[#333] disabled:opacity-50"
          >
            {posting ? 'Posting...' : 'Post to X'}
          </button>
        )}
        {isTiktok && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { navigator.clipboard.writeText(value); setPostStatus('Copied!'); setTimeout(() => setPostStatus(''), 2000) }}
              className="text-[11px] py-1 px-2.5 border border-black rounded-sm bg-black text-white cursor-pointer font-sans hover:bg-[#333]"
            >
              Copy caption
            </button>
            {canPostTk && (
              <button
                onClick={() => handlePost('tiktok')}
                disabled={posting}
                className="text-[11px] py-1 px-2.5 border border-[#fe2c55] rounded-sm bg-[#fe2c55] text-white cursor-pointer font-sans hover:bg-[#e0264c] disabled:opacity-50"
              >
                {posting ? 'Posting...' : 'Post to TikTok'}
              </button>
            )}
            {!canPostTk && !settings?.tiktok_connected && (
              <span className="text-[10px] text-muted">Connect TikTok in settings to post directly</span>
            )}
          </div>
        )}
        {canPostGoogle && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-[10px] text-muted cursor-pointer select-none">
                <input type="checkbox" checked={googlePostEnabled} onChange={e => setGooglePostEnabled(e.target.checked)} className="w-3 h-3" />
                Google Post
              </label>
              <label className="flex items-center gap-1 text-[10px] text-muted cursor-pointer select-none">
                <input type="checkbox" checked={googleGalleryEnabled} onChange={e => setGoogleGalleryEnabled(e.target.checked)} className="w-3 h-3" />
                Photo gallery
              </label>
            </div>
            <button
              onClick={() => handlePost('google', { googlePost: googlePostEnabled, googleGallery: googleGalleryEnabled })}
              disabled={posting || (!googlePostEnabled && !googleGalleryEnabled)}
              className="text-[11px] py-1 px-2.5 border border-[#4285F4] rounded-sm bg-[#4285F4] text-white cursor-pointer font-sans hover:bg-[#3574d4] disabled:opacity-50"
            >
              {posting ? 'Posting...' : `Post to Google${googlePostEnabled && googleGalleryEnabled ? ' (Post + Gallery)' : googlePostEnabled ? ' (Post)' : ' (Gallery)'}`}
            </button>
          </div>
        )}
        {canPostPinterest && (
          <button
            onClick={() => handlePost('pinterest')}
            disabled={posting}
            className="text-[11px] py-1 px-2.5 border border-[#E60023] rounded-sm bg-[#E60023] text-white cursor-pointer font-sans hover:bg-[#cc001e] disabled:opacity-50"
          >
            {posting ? 'Pinning...' : 'Pin to Pinterest'}
          </button>
        )}
        {canPostYt && (
          <button
            onClick={() => handlePost('youtube')}
            disabled={posting}
            className="text-[11px] py-1 px-2.5 border border-[#FF0000] rounded-sm bg-[#FF0000] text-white cursor-pointer font-sans hover:bg-[#cc0000] disabled:opacity-50"
          >
            {posting ? 'Uploading...' : 'Upload to YouTube Shorts'}
          </button>
        )}
        {!canPostYt && platform === 'youtube' && !isVideo && (
          <span className="text-[10px] text-muted italic">YouTube Shorts requires a video</span>
        )}
        {canPostWp && (
          <>
            {wpCategories.length > 0 && (
              <select
                multiple
                value={selectedCats.map(String)}
                onChange={e => setSelectedCats(Array.from(e.target.selectedOptions, o => Number(o.value)))}
                className="text-[10px] border border-border rounded-sm bg-white px-1 py-0.5 max-h-[60px] min-w-[100px]"
                title="Hold Ctrl/Cmd to select multiple categories"
              >
                {wpCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-1 text-[10px] text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={wpPublish}
                onChange={e => setWpPublish(e.target.checked)}
                className="accent-[#21759B]"
              />
              Publish immediately
            </label>
            <button
              onClick={() => handlePost('wordpress')}
              disabled={posting}
              className="text-[11px] py-1 px-2.5 border border-[#21759B] rounded-sm bg-[#21759B] text-white cursor-pointer font-sans hover:bg-[#1a5f7a] disabled:opacity-50"
            >
              {posting ? 'Posting...' : wpPublish ? 'Publish to WordPress' : 'Save Draft to WordPress'}
            </button>
          </>
        )}
        <button onClick={onRegen} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Regenerate</button>
        <button onClick={() => navigator.clipboard.writeText(value)} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Copy</button>
        <button onClick={() => onRefine(value)} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Refine</button>
        {saved && <span className="text-[10px] text-sage">Saved</span>}
        {postStatus && <span className={`text-[10px] ${postStatus.startsWith('Failed') ? 'text-[#c0392b]' : postStatus.startsWith('Warning') ? 'text-[#856404]' : 'text-sage'}`}>{postStatus}</span>}
        {scoreLabel && (
          <span
            className={`text-[10px] py-0.5 px-2 rounded-xl font-semibold border ${
              score.score <= 30 ? 'bg-[#e8efe9] text-[#3a6b42] border-[#3a6b42]' :
              score.score <= 60 ? 'bg-[#fef3cd] text-[#856404] border-[#856404]' :
              'bg-[#fdeaea] text-[#c0392b] border-[#c0392b]'
            }`}
            title={score.reason}
          >
            {scoreLabel} {score.score}%
          </span>
        )}
      </div>
    </>
  )
}
