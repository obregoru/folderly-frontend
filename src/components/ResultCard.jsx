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

  // Thumbnail src — memoized to prevent re-render blob URL churn
  const [thumbSrc] = useState(() => item.isImg
    ? URL.createObjectURL(item.file)
    : (item.uploadResult?.thumbnail_path
      ? (item.uploadResult.thumbnail_path.startsWith('http') ? item.uploadResult.thumbnail_path : `/uploads/${item.uploadResult.thumbnail_path}`)
      : null))
  const [fileSrc] = useState(() => item.file ? URL.createObjectURL(item.file) : null)
  const isVideo = item.file?.type?.startsWith('video/')
  const [showPreview, setShowPreview] = useState(false)
  const [videoThumb, setVideoThumb] = useState(() => item.file?._videoThumb || null)
  const [videoAspect, setVideoAspect] = useState(() => item.file?._videoAspect || null)

  return (
    <div className="bg-white border border-border rounded mb-2.5">
      {/* Media preview lightbox */}
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="relative max-w-[90vw] max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowPreview(false)} className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10">&times;</button>
            {isVideo ? (
              <video
                src={fileSrc}
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
        {isVideo ? (
          <div onClick={() => setShowPreview(true)} className="rounded-sm overflow-hidden flex-shrink-0 cursor-pointer hover:opacity-80 relative bg-black" style={{ width: videoAspect && videoAspect < 1 ? 24 : 36, height: videoAspect && videoAspect < 1 ? 36 : 24 }}>
            {videoThumb ? (
              <img src={videoThumb} className="w-full h-full object-cover" />
            ) : (
              <video src={fileSrc + '#t=0.5'} className="w-full h-full object-cover" muted playsInline preload="auto" />
            )}
            <div className="absolute inset-0 flex items-center justify-center"><span className="text-white text-[10px] bg-black/50 rounded-full w-5 h-5 flex items-center justify-center">▶</span></div>
          </div>
        ) : thumbSrc ? (
          <img src={thumbSrc} onClick={() => setShowPreview(true)} className="w-9 h-9 rounded-sm object-cover flex-shrink-0 cursor-pointer hover:opacity-80" />
        ) : (
          <div className="w-9 h-9 rounded-sm bg-ink flex items-center justify-center text-white text-[13px] flex-shrink-0">?</div>
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
        <div className="py-3 px-3.5 text-xs text-[#A32D2D]">{item.errMsg || 'Error generating content.'}</div>
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
  const [schedTimes, setSchedTimes] = useState({})
  const [scheduling, setScheduling] = useState(false)
  const [scheduleStatus, setScheduleStatus] = useState('')
  const [useSuggestedTimes, setUseSuggestedTimes] = useState(false)
  const [schedOverlay, setSchedOverlay] = useState('none')
  const [schedOverlayYPct, setSchedOverlayYPct] = useState(70)
  const [schedFontSize, setSchedFontSize] = useState(48)
  const [schedFontColor, setSchedFontColor] = useState('#ffffff')
  const [schedFontOutline, setSchedFontOutline] = useState(false)
  const [schedOpeningText, setSchedOpeningText] = useState('')
  const [schedClosingText, setSchedClosingText] = useState('')
  const [schedOpeningDuration, setSchedOpeningDuration] = useState(3)
  const [schedClosingDuration, setSchedClosingDuration] = useState(3)
  // Per-platform destination toggles for scheduling
  const isVideoFile = item.file?.type?.startsWith('video/')
  const [schedDests, setSchedDests] = useState(() => {
    const d = {}
    if (available.some(p => p.key === 'instagram') && settings?.ig_connected) { d.ig_post = true; d.ig_story = settings?.fb_stories_default === true }
    if (available.some(p => p.key === 'facebook') && settings?.fb_connected) { d.fb_post = true; d.fb_reel = false; d.fb_story = settings?.fb_stories_default === true }
    if (available.some(p => p.key === 'youtube') && settings?.youtube_connected) d.yt_shorts = true
    return d
  })

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

    // Get pre-rendered overlay if available
    let overlayBase64 = null
    const hasOverlay = isVideoFile && schedOverlay === 'overlay' && (schedOpeningText || schedClosingText)
    if (hasOverlay && item._overlayPreviewUrl) {
      try {
        const resp = await fetch(item._overlayPreviewUrl)
        const blob = await resp.blob()
        overlayBase64 = await new Promise(resolve => {
          const r = new FileReader()
          r.onload = () => resolve(r.result.split(',')[1])
          r.readAsDataURL(blob)
        })
      } catch (e) { console.error('Failed to read overlay preview:', e) }
    }

    const overlayOpts = hasOverlay && !overlayBase64 ? {
      caption_style: 'overlay', overlay_y_pct: schedOverlayYPct,
      font_size: schedFontSize, font_color: schedFontColor, font_outline: schedFontOutline,
      opening_text: schedOpeningText, closing_text: schedClosingText,
      opening_duration: schedOpeningDuration, closing_duration: schedClosingDuration,
    } : {}

    for (const p of postable) {
      const caption = getText(item.captions[p.key])
      if (!caption) { newResults[p.key] = 'Skipped: no content'; continue }

      try {
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
        } else if (isVideoFile && item.file) {
          try { imageBase64 = await fileToBase64(item.file) } catch { imageBase64 = null }
          mediaType = item.file.type
        }

        // Use pre-rendered overlay for overlay destinations
        const useOverlay = hasOverlay && overlayBase64
        const oB64 = useOverlay ? overlayBase64 : imageBase64
        const oMt = useOverlay ? 'video/mp4' : mediaType

        // Feed posts
        if (p.key === 'facebook' && schedDests.fb_post) {
          try { await api.postToFacebook(caption, imageBase64, mediaType); newResults.fb_post = 'success' } catch (e) { newResults.fb_post = 'Failed: ' + e.message }
        }
        if (p.key === 'facebook' && isVideoFile && schedDests.fb_reel) {
          try { await api.postToFacebookReel(caption, oB64, oMt, useOverlay ? {} : overlayOpts); newResults.fb_reel = 'success' } catch (e) { newResults.fb_reel = 'Failed: ' + e.message }
        }
        if (p.key === 'facebook' && schedDests.fb_story) {
          try { await api.postToFacebookStory(caption, oB64, oMt, useOverlay ? 'none' : schedOverlay, schedOverlayYPct, useOverlay ? {} : { fontSize: schedFontSize, fontColor: schedFontColor, fontOutline: schedFontOutline, openingText: schedOpeningText, closingText: schedClosingText, openingDuration: schedOpeningDuration, closingDuration: schedClosingDuration }); newResults.fb_story = 'success' } catch (e) { newResults.fb_story = 'Failed: ' + e.message }
        }
        if (p.key === 'instagram' && schedDests.ig_post) {
          try { await api.postToInstagram(caption, useOverlay ? oB64 : imageBase64, useOverlay ? oMt : mediaType, useOverlay ? {} : overlayOpts); newResults.ig_post = 'success' } catch (e) { newResults.ig_post = 'Failed: ' + e.message }
        }
        if (p.key === 'instagram' && schedDests.ig_story) {
          try { await api.postToInstagramStory(caption, oB64, oMt, useOverlay ? 'none' : schedOverlay, schedOverlayYPct, useOverlay ? {} : { fontSize: schedFontSize, fontColor: schedFontColor, fontOutline: schedFontOutline, openingText: schedOpeningText, closingText: schedClosingText, openingDuration: schedOpeningDuration, closingDuration: schedClosingDuration }); newResults.ig_story = 'success' } catch (e) { newResults.ig_story = 'Failed: ' + e.message }
        }
        if (p.key === 'twitter') {
          try { await api.postToTwitter(caption, imageBase64, mediaType); newResults.twitter = 'success' } catch (e) { newResults.twitter = 'Failed: ' + e.message }
        }
        if (p.key === 'google') {
          try { await api.postToGoogle(caption, imageBase64, mediaType); newResults.google = 'success' } catch (e) { newResults.google = 'Failed: ' + e.message }
        }
        if (p.key === 'pinterest') {
          try { await api.postToPinterest(caption, imageBase64, mediaType); newResults.pinterest = 'success' } catch (e) { newResults.pinterest = 'Failed: ' + e.message }
        }
        if (p.key === 'youtube' && schedDests.yt_shorts) {
          const ytCap = item.captions?.youtube
          const ytCaption = JSON.stringify({ title: (ytCap && typeof ytCap === 'object' ? ytCap.title : null) || item.name || 'Short', description: caption, tags: (ytCap && typeof ytCap === 'object' ? ytCap.tags : null) || ['Shorts'] })
          try { await api.postToYoutubeShorts(ytCaption, useOverlay ? oB64 : imageBase64, useOverlay ? oMt : (item.file?.type || mediaType), useOverlay ? {} : overlayOpts); newResults.yt_shorts = 'success' } catch (e) { newResults.yt_shorts = 'Failed: ' + e.message }
        }
        if (p.key === 'youtube' && schedDests.yt_video) {
          const ytCap = item.captions?.youtube
          const ytCaption = JSON.stringify({ title: (ytCap && typeof ytCap === 'object' ? ytCap.title : null) || item.name || 'Video', description: caption, tags: (ytCap && typeof ytCap === 'object' ? ytCap.tags : null) || [] })
          try { await api.postToYoutubeVideo(ytCaption, imageBase64, item.file?.type || mediaType); newResults.yt_video = 'success' } catch (e) { newResults.yt_video = 'Failed: ' + e.message }
        }
        if (p.key === 'blog') {
          const blogCap = item.captions[p.key]
          const wpTitle = getTitle(blogCap) || item.name || item.file?.name?.replace(/\.[^.]+$/, '') || 'New Post'
          try { await api.postToWordPress(wpTitle, caption, imageBase64, mediaType, selectedCats, wpPublishAll); newResults.blog = wpPublishAll ? 'success' : 'draft' } catch (e) { newResults.blog = 'Failed: ' + e.message }
        }
      } catch (err) {
        newResults[p.key] = 'Failed: ' + err.message
      }

      setResults({ ...newResults })
    }

    setPosting(false)
  }

  const buildPostsPayload = async () => {
    const posts = []

    // If there's a pre-generated overlay preview, convert it to base64 once
    let overlayBase64 = null
    if (item._overlayPreviewUrl && isVideoFile) {
      try {
        const resp = await fetch(item._overlayPreviewUrl)
        const blob = await resp.blob()
        overlayBase64 = await new Promise(resolve => {
          const r = new FileReader()
          r.onload = () => resolve(r.result.split(',')[1])
          r.readAsDataURL(blob)
        })
      } catch (e) { console.error('Failed to read overlay preview:', e) }
    }

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

      const post = { platform: p.key, caption, image_base64: imageBase64, media_type: mediaType, job_name: item.job_name || item.file?.name?.replace(/\.[^.]+$/, '') }
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
      // Only include feed post if the destination is checked
      const overlayOpts = schedOverlay === 'overlay' ? {
        caption_style: 'overlay', overlay_y_pct: schedOverlayYPct,
        font_size: schedFontSize, font_color: schedFontColor, font_outline: schedFontOutline,
        opening_text: schedOpeningText, closing_text: schedClosingText,
        opening_duration: schedOpeningDuration, closing_duration: schedClosingDuration,
      } : {}

      if (p.key === 'instagram' && schedDests.ig_post) {
        // For IG reel (video), use pre-rendered overlay if available
        if (isVideo && usePreRendered) { post.image_base64 = overlayBase64; post.media_type = 'video/mp4' }
        else if (isVideo && schedOverlay === 'overlay') Object.assign(post, overlayOpts)
        posts.push(post)
      }
      else if (p.key === 'facebook' && schedDests.fb_post) posts.push(post) // FB post = no overlays
      else if (p.key === 'youtube' && schedDests.yt_shorts) {
        // YT Shorts: use pre-rendered overlay if available
        if (usePreRendered) { post.image_base64 = overlayBase64; post.media_type = 'video/mp4' }
        else if (schedOverlay === 'overlay') Object.assign(post, overlayOpts)
        posts.push(post)
      }
      else if (p.key !== 'instagram' && p.key !== 'facebook' && p.key !== 'youtube') posts.push(post)

      // For overlay destinations: use pre-generated preview if available, otherwise pass overlay opts for backend processing
      const usePreRendered = overlayBase64 && schedOverlay === 'overlay'
      const overlayB64 = usePreRendered ? overlayBase64 : imageBase64
      const overlayMt = usePreRendered ? 'video/mp4' : mediaType
      const overlayPostOpts = usePreRendered ? {} : overlayOpts // skip overlay opts if already processed

      // Add IG story
      if (p.key === 'instagram' && schedDests.ig_story) {
        posts.push({ platform: 'instagram_story', caption, image_base64: overlayB64, media_type: overlayMt, ...overlayPostOpts, _story_offset: true })
      }
      // Add FB story
      if (p.key === 'facebook' && schedDests.fb_story) {
        posts.push({ platform: 'facebook_story', caption, image_base64: overlayB64, media_type: overlayMt, ...overlayPostOpts, _story_offset: true })
      }
      // Add FB reel
      if (p.key === 'facebook' && isVideoFile && schedDests.fb_reel) {
        posts.push({ platform: 'facebook_reel', caption, image_base64: overlayB64, media_type: overlayMt, ...overlayPostOpts })
      }
      // Add YT Shorts (if not already the youtube platform post)
      if (p.key === 'youtube' && schedDests.yt_shorts) {
        // YouTube post is already added above with its special caption format
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
        // Per-channel manual scheduling
        const hasAnyTime = Object.values(schedTimes).some(Boolean) || scheduleDate
        if (!hasAnyTime) { setScheduling(false); return }

        let totalScheduled = 0
        // Map post platforms to their schedTimes key
        const PLAT_TO_DEST = {
          'instagram': 'ig_post', 'instagram_story': 'ig_story',
          'facebook': 'fb_post', 'facebook_story': 'fb_story', 'facebook_reel': 'fb_reel',
          'youtube': schedDests.yt_shorts ? 'yt_shorts' : 'yt_video',
          'twitter': 'twitter', 'tiktok': 'tiktok', 'google': 'google', 'blog': 'blog', 'pinterest': 'pinterest',
        }
        const STORY_PARENTS = { 'ig_story': 'ig_post', 'fb_story': 'fb_post' }

        for (const post of posts) {
          const destKey = PLAT_TO_DEST[post.platform] || post.platform
          let time = schedTimes[destKey]

          // Story auto-offset: if no explicit time, use parent +45min
          if (!time && STORY_PARENTS[destKey]) {
            const parentTime = schedTimes[STORY_PARENTS[destKey]]
            if (parentTime) time = new Date(new Date(parentTime).getTime() + 45 * 60000).toISOString().slice(0, 16)
          }

          // Fallback to the old single datetime
          if (!time) time = scheduleDate
          if (!time) continue

          const result = await api.schedulePosts([post], new Date(time).toISOString())
          totalScheduled += result.scheduled?.length || 0
        }
        setScheduleStatus(`Scheduled ${totalScheduled} posts`)
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
        {hasResults && Object.entries(results).map(([key, r]) => {
          const isOk = r === 'success' || r === 'draft'
          const DEST_LABELS = { fb_post: 'FB Post', fb_reel: 'FB Reel', fb_story: 'FB Story', ig_post: 'IG', ig_story: 'IG Story', yt_shorts: 'YT Shorts', yt_video: 'YT Video', twitter: 'X', google: 'Google', pinterest: 'Pinterest', blog: 'Blog', tiktok: 'TikTok' }
          return (
            <span key={key} className={`text-[10px] ${isOk ? 'text-[#2D9A5E]' : 'text-[#c0392b]'}`}>
              {DEST_LABELS[key] || key}: {r === 'success' ? 'Posted' : r === 'draft' ? 'Draft' : r}
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
          {/* Destination checkboxes for scheduling */}
          {postable.some(p => ['facebook', 'instagram', 'youtube'].includes(p.key)) && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted font-medium">Schedule to:</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {settings?.ig_connected && available.some(p => p.key === 'instagram') && (
                  <>
                    <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={schedDests.ig_post || false} onChange={e => setSchedDests(d => ({...d, ig_post: e.target.checked}))} className="accent-[#E1306C]" />
                      {isVideoFile ? 'IG Reel' : 'IG Post'}
                    </label>
                    <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={schedDests.ig_story || false} onChange={e => setSchedDests(d => ({...d, ig_story: e.target.checked}))} className="accent-[#833AB4]" />
                      IG Story
                    </label>
                  </>
                )}
                {settings?.fb_connected && available.some(p => p.key === 'facebook') && (
                  <>
                    <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={schedDests.fb_post || false} onChange={e => setSchedDests(d => ({...d, fb_post: e.target.checked}))} className="accent-[#1877F2]" />
                      FB Post
                    </label>
                    {isVideoFile && (
                      <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                        <input type="checkbox" checked={schedDests.fb_reel || false} onChange={e => setSchedDests(d => ({...d, fb_reel: e.target.checked}))} className="accent-[#1877F2]" />
                        FB Reel
                      </label>
                    )}
                    <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={schedDests.fb_story || false} onChange={e => setSchedDests(d => ({...d, fb_story: e.target.checked}))} className="accent-[#4267B2]" />
                      FB Story
                    </label>
                  </>
                )}
                {settings?.youtube_connected && available.some(p => p.key === 'youtube') && isVideoFile && (
                  <>
                    <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={schedDests.yt_shorts || false} onChange={e => setSchedDests(d => ({...d, yt_shorts: e.target.checked}))} className="accent-[#FF0000]" />
                      YT Shorts
                    </label>
                    <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={schedDests.yt_video || false} onChange={e => setSchedDests(d => ({...d, yt_video: e.target.checked}))} className="accent-[#FF0000]" />
                      YT Video
                    </label>
                  </>
                )}
              </div>
              {/* Overlay controls for video */}
              {isVideoFile && (schedDests.ig_post || schedDests.ig_story || schedDests.fb_reel || schedDests.fb_story || schedDests.yt_shorts) && (
                <div className="bg-[#f8f9fa] rounded px-2.5 py-1.5 space-y-1.5">
                  <div className="flex gap-3 text-[10px]">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="sched-overlay" value="none" checked={schedOverlay === 'none'} onChange={() => setSchedOverlay('none')} /> No overlay
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="sched-overlay" value="overlay" checked={schedOverlay === 'overlay'} onChange={() => setSchedOverlay('overlay')} /> Text overlay
                    </label>
                  </div>
                  {schedOverlay === 'overlay' && (
                    <>
                      <div className="flex gap-1.5">
                        <textarea rows={2} value={schedOpeningText} onChange={e => setSchedOpeningText(e.target.value)} placeholder={"Opening text\n(Enter for line break)"} className="flex-1 text-[10px] border border-border rounded py-0.5 px-1 bg-white resize-none" />
                        <textarea rows={2} value={schedClosingText} onChange={e => setSchedClosingText(e.target.value)} placeholder={"Closing text\n(Enter for line break)"} className="flex-1 text-[10px] border border-border rounded py-0.5 px-1 bg-white resize-none" />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-[9px] text-muted">Position:
                          <input type="range" min={0} max={100} value={schedOverlayYPct} onChange={e => setSchedOverlayYPct(Number(e.target.value))} className="w-16 ml-1 align-middle" />
                        </label>
                        <select value={schedFontSize} onChange={e => setSchedFontSize(Number(e.target.value))} className="text-[9px] border border-border rounded px-1 bg-white">
                          <option value={32}>Small</option><option value={48}>Medium</option><option value={64}>Large</option><option value={80}>XXXL</option>
                        </select>
                        <input type="color" value={schedFontColor} onChange={e => setSchedFontColor(e.target.value)} className="w-5 h-4 border-none" />
                        <label className="flex items-center gap-1 text-[9px] cursor-pointer">
                          <input type="checkbox" checked={schedFontOutline} onChange={e => setSchedFontOutline(e.target.checked)} /> Outline
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <label className="text-[9px] text-muted">Opening: <select value={schedOpeningDuration} onChange={e => setSchedOpeningDuration(Number(e.target.value))} className="text-[9px] border border-border rounded px-0.5 bg-white">{[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}s</option>)}</select></label>
                        <label className="text-[9px] text-muted">Closing: <select value={schedClosingDuration} onChange={e => setSchedClosingDuration(Number(e.target.value))} className="text-[9px] border border-border rounded px-0.5 bg-white">{[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}s</option>)}</select></label>
                      </div>
                      <p className="text-[8px] text-muted">Overlays: {[schedDests.ig_post && 'IG Reel', schedDests.ig_story && 'IG Story', schedDests.fb_reel && 'FB Reel', schedDests.fb_story && 'FB Story', schedDests.yt_shorts && 'YT Shorts'].filter(Boolean).join(', ') || 'none'}{schedDests.fb_post ? '. FB Post = no overlay.' : ''}</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Per-channel datetime pickers (manual mode) */}
          {!useSuggestedTimes && (
            <div className="space-y-1">
              <p className="text-[9px] text-muted">Set time per destination (stories auto-offset +45min from feed):</p>
              {(() => {
                const DEST_CONFIG = [
                  { key: 'ig_post', label: isVideoFile ? 'IG Reel' : 'IG Post', color: '#E1306C', parent: null, show: schedDests.ig_post },
                  { key: 'ig_story', label: 'IG Story', color: '#833AB4', parent: 'ig_post', show: schedDests.ig_story },
                  { key: 'fb_post', label: 'FB Post', color: '#1877F2', parent: null, show: schedDests.fb_post },
                  { key: 'fb_reel', label: 'FB Reel', color: '#1877F2', parent: null, show: schedDests.fb_reel },
                  { key: 'fb_story', label: 'FB Story', color: '#4267B2', parent: 'fb_post', show: schedDests.fb_story },
                  { key: 'yt_shorts', label: 'YT Shorts', color: '#FF0000', parent: null, show: schedDests.yt_shorts },
                  { key: 'yt_video', label: 'YT Video', color: '#FF0000', parent: null, show: schedDests.yt_video },
                ]
                // Also include non-checkbox platforms (twitter, tiktok, google, blog, pinterest)
                const otherPlats = postable.filter(p => !['instagram', 'facebook', 'youtube'].includes(p.key))
                otherPlats.forEach(p => DEST_CONFIG.push({ key: p.key, label: PLATFORM_LABELS[p.key], color: PLATFORM_COLORS[p.key], parent: null, show: true }))

                return DEST_CONFIG.filter(d => d.show).map(d => {
                  const isStory = d.parent
                  const parentTime = isStory && schedTimes[d.parent]
                  const autoTime = parentTime ? new Date(new Date(parentTime).getTime() + 45 * 60000).toISOString().slice(0, 16) : ''
                  return (
                    <div key={d.key} className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium min-w-[65px]" style={{ color: d.color }}>{d.label}</span>
                      <input
                        type="datetime-local"
                        value={schedTimes[d.key] || (isStory ? autoTime : '')}
                        onChange={e => setSchedTimes(t => ({...t, [d.key]: e.target.value}))}
                        min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                        className="text-[10px] border border-border rounded px-1.5 py-0.5 bg-white flex-1"
                      />
                      {isStory && parentTime && !schedTimes[d.key] && (
                        <span className="text-[8px] text-muted">auto +45min</span>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleScheduleAll}
              disabled={scheduling || (!useSuggestedTimes && !Object.values(schedTimes).some(Boolean) && !scheduleDate)}
              className="text-[11px] py-1 px-2.5 rounded-sm bg-[#6C5CE7] text-white cursor-pointer font-sans hover:bg-[#5a4bd6] disabled:opacity-50 border-none"
            >
              {scheduling ? 'Scheduling...' : useSuggestedTimes ? `Schedule at best times` : `Schedule Selected`}
            </button>
            <button
              onClick={() => { setShowSchedule(false); setScheduleDate(''); setUseSuggestedTimes(false); setSchedTimes({}) }}
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
  const [showAiAnalysis, setShowAiAnalysis] = useState(false)
  // storyEnabled is derived from postDests — defined after postDests below
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
  const [postDests, setPostDests] = useState({
    ig_post: platform === 'instagram',
    ig_story: platform === 'instagram' && settings?.fb_stories_default === true,
    fb_post: platform === 'facebook',
    fb_reel: false,
    fb_story: platform === 'facebook' && settings?.fb_stories_default === true,
    yt_shorts: platform === 'youtube',
    yt_video: false,
    twitter: platform === 'twitter',
    tiktok: platform === 'tiktok',
    google: platform === 'google',
    pinterest: platform === 'pinterest',
    blog: platform === 'blog',
  })
  const storyEnabled = postDests.ig_story || postDests.fb_story
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
          const SAFE_BOTTOM = Math.round(1920 * 0.75)

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
  const [converting, setConverting] = useState(false)
  const [mp4Quality, setMp4Quality] = useState('medium')
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
      if (target === 'twitter') {
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
          setPostStatus(result.message || 'Content copied — post manually on TikTok')
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

  const humanScore = score?.score >= 0 ? 100 - score.score : null
  const scoreLabel = humanScore !== null
    ? (humanScore >= 70 ? 'Human' : humanScore >= 40 ? 'Mixed' : 'AI-like')
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
        {postStatus === 'Copied!' ? 'Copied!' : 'Copy Content'}
      </button>
      <div className="flex flex-col gap-2 mt-2">
        {platform === 'youtube' && (
          <button
            onClick={() => {
              const full = `${title}\n\n${value}${tags.length ? '\n\nTags: ' + tags.join(', ') : ''}`
              navigator.clipboard.writeText(full)
            }}
            className="text-[11px] py-1 px-2.5 border border-[#FF0000] rounded-sm bg-[#FF0000] text-white cursor-pointer font-sans hover:bg-[#cc0000] self-end"
          >Copy All for YouTube</button>
        )}

        {/* Convert to MP4 — for non-MP4 videos (e.g. MOV from iPhone) */}
        {isVideoFile && item.file?.type !== 'video/mp4' && (
          <div className="flex items-center gap-2 border-t border-border pt-2 flex-wrap">
            <select value={mp4Quality} onChange={e => setMp4Quality(e.target.value)} className="text-[10px] border border-border rounded py-1 px-1.5 bg-white">
              <option value="high">High quality</option>
              <option value="medium">Medium</option>
              <option value="low">Small file</option>
            </select>
            <button
              disabled={converting}
              onClick={async () => {
                setConverting(true)
                try {
                  const b64 = await fileToBase64(item.file)
                  const api = await import('../api')
                  const r = await api.convertToMp4(b64, item.file.type, mp4Quality)
                  if (r.error) throw new Error(r.error)
                  const byteChars = atob(r.mp4_base64)
                  const bytes = new Uint8Array(byteChars.length)
                  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
                  const blob = new Blob([bytes], { type: 'video/mp4' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = (item.file?.name?.replace(/\.[^.]+$/, '') || 'video') + `-${mp4Quality}.mp4`
                  document.body.appendChild(a); a.click(); document.body.removeChild(a)
                  setTimeout(() => URL.revokeObjectURL(url), 5000)
                } catch (e) { alert('Convert failed: ' + e.message) }
                setConverting(false)
              }}
              className="text-[10px] py-1 px-2.5 border border-[#4285F4] text-[#4285F4] rounded cursor-pointer hover:bg-[#4285F4]/10 disabled:opacity-50"
            >
              {converting ? 'Converting...' : 'Convert to MP4 & Download'}
            </button>
            <span className="text-[9px] text-muted">For Google Business (MOV not supported)</span>
          </div>
        )}

        {/* Destination checkboxes */}
        {(canPostFb || canPostIg || canPostYt || canPostTw || canPostTk || canPostGoogle || canPostWp || canPostPinterest || isTiktok) && (
          <div className="border-t border-border pt-2">
            <p className="text-[10px] text-muted font-medium mb-1.5">Post to:</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {canPostIg && (
                <>
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={postDests.ig_post} onChange={e => setPostDests(d => ({...d, ig_post: e.target.checked}))} className="accent-[#E1306C]" />
                    <span>{isVideoFile ? 'IG Reel' : 'IG Post'}</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={postDests.ig_story} onChange={e => setPostDests(d => ({...d, ig_story: e.target.checked}))} className="accent-[#833AB4]" />
                    <span>IG Story</span>
                  </label>
                </>
              )}
              {canPostFb && (
                <>
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={postDests.fb_post} onChange={e => setPostDests(d => ({...d, fb_post: e.target.checked}))} className="accent-[#1877F2]" />
                    <span>FB Post</span>
                  </label>
                  {isVideoFile && (
                    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                      <input type="checkbox" checked={postDests.fb_reel} onChange={e => setPostDests(d => ({...d, fb_reel: e.target.checked}))} className="accent-[#1877F2]" />
                      <span>FB Reel</span>
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={postDests.fb_story} onChange={e => setPostDests(d => ({...d, fb_story: e.target.checked}))} className="accent-[#4267B2]" />
                    <span>FB Story</span>
                  </label>
                </>
              )}
              {canPostYt && (
                <>
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={postDests.yt_shorts} onChange={e => setPostDests(d => ({...d, yt_shorts: e.target.checked}))} className="accent-[#FF0000]" />
                    <span>YT Shorts</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={postDests.yt_video} onChange={e => setPostDests(d => ({...d, yt_video: e.target.checked}))} className="accent-[#FF0000]" />
                    <span>YT Video</span>
                  </label>
                </>
              )}
              {canPostTw && (
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={postDests.twitter || false} onChange={e => setPostDests(d => ({...d, twitter: e.target.checked}))} className="accent-[#000]" />
                  <span>X / Twitter</span>
                </label>
              )}
              {(canPostTk || isTiktok) && (
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={postDests.tiktok || false} onChange={e => setPostDests(d => ({...d, tiktok: e.target.checked}))} className="accent-[#000]" />
                  <span>TikTok {!canPostTk ? '(copy)' : ''}</span>
                </label>
              )}
              {canPostGoogle && (
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={postDests.google || false} onChange={e => setPostDests(d => ({...d, google: e.target.checked}))} className="accent-[#4285F4]" />
                  <span>Google</span>
                </label>
              )}
              {canPostPinterest && (
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={postDests.pinterest || false} onChange={e => setPostDests(d => ({...d, pinterest: e.target.checked}))} className="accent-[#E60023]" />
                  <span>Pinterest</span>
                </label>
              )}
              {canPostWp && (
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={postDests.blog || false} onChange={e => setPostDests(d => ({...d, blog: e.target.checked}))} className="accent-[#21759B]" />
                  <span>Blog</span>
                </label>
              )}
            </div>

            {/* Video overlay controls — shown when any overlay-supporting destination is checked */}
            {isVideoFile && (postDests.ig_post || postDests.ig_story || postDests.fb_reel || postDests.fb_story || postDests.yt_shorts) && (
              <div className="mt-2 border-t border-border pt-2">
                <div className="flex gap-3 text-[10px] mb-1 items-center">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name={`overlay-style-${item.id}`} value="none" checked={storyCaptionStyle === 'none'} onChange={() => setStoryCaptionStyle('none')} />
                    No overlay
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name={`overlay-style-${item.id}`} value="overlay" checked={storyCaptionStyle === 'overlay'} onChange={() => setStoryCaptionStyle('overlay')} />
                    Text overlay
                  </label>
                  {storyCaptionStyle === 'overlay' && settings?.overlay_templates?.length > 0 && (
                    <select className="text-[9px] border border-border rounded px-1 py-0.5 bg-white ml-auto" defaultValue="" onChange={e => {
                      const t = settings.overlay_templates.find(t => t.id === e.target.value)
                      if (t) {
                        setOpeningText(t.openingText || ''); setClosingText(t.closingText || '')
                        setOpeningDuration(t.openingDuration || 3); setClosingDuration(t.closingDuration || 3)
                        setStoryFontSize(t.fontSize || 48); setStoryFontColor(t.fontColor || '#ffffff')
                        setStoryFontOutline(t.fontOutline || false); setOverlayYPct(t.overlayYPct || 50)
                      }
                      e.target.value = ''
                    }}>
                      <option value="" disabled>Load template...</option>
                      {settings.overlay_templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                </div>
                {storyCaptionStyle === 'overlay' && (
                  <div className="mt-1.5 space-y-1.5">
                    {/* Video preview with live overlays */}
                    {isVideoFile && (
                      <div className="flex gap-1">
                        <div className="relative rounded border border-border overflow-hidden bg-black flex-shrink-0" style={{ width: 120, height: Math.round(120 / 9 * 16) }}>
                          {generatedPreviewUrl ? (
                            <>
                              <video src={generatedPreviewUrl} className="w-full h-full object-contain" controls muted autoPlay loop playsInline />
                              <a href={generatedPreviewUrl} download={`${item.file?.name?.replace(/\.[^.]+$/, '') || 'video'}-overlay.mp4`} className="absolute top-1 right-1 text-[7px] bg-black/60 text-white rounded px-1.5 py-0.5 no-underline hover:bg-black/80 z-10">Save</a>
                            </>
                          ) : (
                            <>
                              <video ref={videoPreviewRef} src={videoSrc} className="w-full h-full object-cover" style={{ objectPosition: 'center 33%' }} muted loop playsInline onTimeUpdate={e => setVideoTime(e.target.currentTime)} onLoadedMetadata={e => setVideoDuration(e.target.duration)} />
                              <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '15%', borderTop: '1px dashed rgba(255,255,255,0.4)' }} />
                              <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '75%', borderTop: '1px dashed rgba(255,255,255,0.4)' }} />
                              {(() => {
                                const SCALE = 120 / 1080
                                const hasTimedOverlays = openingText || closingText
                                const closingStart = Math.max(0, videoDuration - closingDuration)
                                const showOpening = hasTimedOverlays && openingText && videoTime >= 0 && videoTime <= openingDuration
                                const showClosing = hasTimedOverlays && closingText && videoDuration > 0 && videoTime >= closingStart
                                const showFull = !hasTimedOverlays && storyText
                                const displayText = showOpening ? openingText : showClosing ? closingText : showFull ? storyText : null
                                if (!displayText) return null
                                const previewH = Math.round(120 / 9 * 16)
                                const scaledFontSize = Math.max(5, Math.round(storyFontSize * SCALE))
                                const safeTopPx = Math.round(previewH * 0.15)
                                const safeBottomPx = Math.round(previewH * 0.75)
                                const textBlockPx = scaledFontSize * 2.5
                                const yPosPx = Math.round(safeTopPx + ((safeBottomPx - textBlockPx - safeTopPx) * overlayYPct / 100)) + Math.round(10 * SCALE)
                                const scaledBorderW = Math.max(0.3, 3 * SCALE)
                                const lineH = Math.round(scaledFontSize * 1.3)
                                const textLines = displayText.split(/\n/).filter(Boolean)
                                return (
                                  <div className="absolute left-0 right-0 pointer-events-none flex flex-col items-center px-0.5" style={{ top: `${yPosPx}px` }}>
                                    {!storyFontOutline && <div className="absolute inset-0 bg-black/50 rounded-sm" />}
                                    {textLines.map((line, i) => (
                                      <span key={i} className="relative text-center block" style={{ fontSize: `${scaledFontSize}px`, lineHeight: `${lineH}px`, fontFamily: storyFontFamily, color: storyFontColor, fontWeight: 600, ...(storyFontOutline ? { WebkitTextStroke: `${scaledBorderW}px black`, paintOrder: 'stroke fill' } : { textShadow: `0 ${Math.round(2 * SCALE)}px ${Math.round(4 * SCALE)}px rgba(0,0,0,0.7)` }) }}>{line}</span>
                                    ))}
                                  </div>
                                )
                              })()}
                              <div className="absolute bottom-1 left-1 right-1 flex items-center gap-0.5">
                                <button onClick={() => { const v = videoPreviewRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 2) }} className="text-white text-[8px] bg-black/60 rounded px-1 py-0.5 cursor-pointer">&lt;</button>
                                <button onClick={() => { const v = videoPreviewRef.current; if (v) v.paused ? v.play() : v.pause() }} className="text-white text-[8px] bg-black/60 rounded px-1.5 py-0.5 cursor-pointer">{videoPreviewRef.current?.paused !== false ? '\u25B6' : '\u23F8'}</button>
                                <button onClick={() => { const v = videoPreviewRef.current; if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 2) }} className="text-white text-[8px] bg-black/60 rounded px-1 py-0.5 cursor-pointer">&gt;</button>
                                <span className="text-white text-[7px] bg-black/60 rounded px-1 py-0.5 ml-auto">{videoTime.toFixed(1)}s</span>
                              </div>
                            </>
                          )}
                        </div>
                        {!generatedPreviewUrl && (
                          <div className="flex flex-col items-center" style={{ height: Math.round(120 / 9 * 16), paddingTop: `${Math.round(120 / 9 * 16) * 0.15}px`, paddingBottom: `${Math.round(120 / 9 * 16) * 0.25}px` }}>
                            <input type="range" min="0" max="100" value={overlayYPct} onChange={e => setOverlayYPct(Number(e.target.value))} className="h-full cursor-pointer" style={{ writingMode: 'vertical-lr', direction: 'ltr', width: 14 }} />
                          </div>
                        )}
                      </div>
                    )}
                    {/* Opening/closing text */}
                    {isVideoFile && (
                      <div className="flex gap-1.5">
                        <div className="flex-1">
                          <textarea className="w-full text-[10px] border border-border rounded py-0.5 px-1 bg-white resize-none" rows={2} value={openingText} onChange={e => setOpeningText(e.target.value)} placeholder={"Opening text\n(Enter for new line)"} />
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[9px] text-muted">Duration:</span>
                            <select className="text-[9px] border border-border rounded py-0 px-0.5 bg-white" value={openingDuration} onChange={e => setOpeningDuration(Number(e.target.value))}>
                              {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}s</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="flex-1">
                          <textarea className="w-full text-[10px] border border-border rounded py-0.5 px-1 bg-white resize-none" rows={2} value={closingText} onChange={e => setClosingText(e.target.value)} placeholder={"Closing text\n(Enter for new line)"} />
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[9px] text-muted">Duration:</span>
                            <select className="text-[9px] border border-border rounded py-0 px-0.5 bg-white" value={closingDuration} onChange={e => setClosingDuration(Number(e.target.value))}>
                              {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}s</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Image overlay text */}
                    {!isVideoFile && (
                      <textarea className="w-full text-[11px] border border-border rounded p-1.5 font-sans resize-none bg-white" rows={2} value={storyText} onChange={e => setStoryText(e.target.value)} placeholder="Overlay text..." />
                    )}
                    {/* Font controls */}
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
                    {/* Generate preview / back to edit */}
                    {isVideoFile && (
                      <div className="flex gap-1">
                        {generatedPreviewUrl && (
                          <>
                            <button onClick={() => { URL.revokeObjectURL(generatedPreviewUrl); setGeneratedPreviewUrl(null) }} className="text-[10px] py-1 px-2 border border-border text-muted rounded cursor-pointer">Back to edit</button>
                            <a href={generatedPreviewUrl} download={`${item.file?.name?.replace(/\.[^.]+$/, '') || 'video'}-overlay.mp4`} className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer no-underline text-center">Download</a>
                          </>
                        )}
                        <button
                          onClick={async () => {
                            setGeneratingPreview(true)
                            try {
                              const { imageBase64, mediaType } = await getImageBase64('facebook_story')
                              const api = await import('../api')
                              const url = await api.previewStory(storyCaptionStyle === 'overlay' ? (storyText || value) : value, imageBase64, mediaType, storyCaptionStyle, overlayYPct, { fontSize: storyFontSize, fontFamily: storyFontFamily, fontColor: storyFontColor, fontOutline: storyFontOutline, openingText, closingText, openingDuration, closingDuration })
                              if (generatedPreviewUrl) URL.revokeObjectURL(generatedPreviewUrl)
                              setGeneratedPreviewUrl(url)
                              item._overlayPreviewUrl = url // share with PostAllBar
                            } catch (err) { console.error(err); alert('Preview failed: ' + err.message) }
                            setGeneratingPreview(false)
                          }}
                          disabled={generatingPreview}
                          className="text-[10px] py-1 px-2 border border-[#2D9A5E] text-[#2D9A5E] rounded cursor-pointer disabled:opacity-50"
                        >{generatingPreview ? 'Generating...' : generatedPreviewUrl ? 'Regenerate' : 'Generate Preview'}</button>
                      </div>
                    )}
                  </div>
                )}
                {/* Save template + overlay info */}
                {storyCaptionStyle === 'overlay' && (
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[9px] text-muted flex-1">Overlays: {[postDests.ig_post && (isVideoFile ? 'IG Reel' : null), postDests.ig_story && 'IG Story', postDests.fb_reel && 'FB Reel', postDests.fb_story && 'FB Story', postDests.yt_shorts && 'YT Shorts'].filter(Boolean).join(', ') || 'none'}{postDests.fb_post || postDests.yt_video ? `. No overlay: ${[postDests.fb_post && 'FB Post', postDests.yt_video && 'YT Video'].filter(Boolean).join(', ')}.` : ''}</p>
                    <button
                      onClick={async () => {
                        const name = prompt('Template name:')
                        if (!name) return
                        const api = await import('../api')
                        await api.saveOverlayTemplate({ name, openingText, closingText, openingDuration, closingDuration, fontSize: storyFontSize, fontColor: storyFontColor, fontOutline: storyFontOutline, overlayYPct })
                        alert('Template saved! Reload to see it in the dropdown.')
                      }}
                      className="text-[9px] text-[#6C5CE7] hover:underline whitespace-nowrap"
                    >Save template</button>
                  </div>
                )}
              </div>
            )}

            {/* Post Selected button */}
            {Object.values(postDests).some(Boolean) && (
              <button
                onClick={async () => {
                  setPosting(true); setPostStatus('')
                  const results = []
                  try {
                    const { imageBase64: rawBase64, mediaType: rawType } = await getImageBase64('facebook_story')
                    const api = await import('../api')
                    const fontOpts = { fontSize: storyFontSize, fontFamily: storyFontFamily, fontColor: storyFontColor, fontOutline: storyFontOutline, openingText, closingText, openingDuration, closingDuration }
                    const hasOverlays = isVideoFile && storyCaptionStyle === 'overlay' && (openingText || closingText || storyText)

                    // If we have a generated preview, use that processed video for overlay destinations
                    let processedBase64 = null
                    if (hasOverlays && generatedPreviewUrl) {
                      try {
                        const resp = await fetch(generatedPreviewUrl)
                        const blob = await resp.blob()
                        processedBase64 = await new Promise(resolve => {
                          const r = new FileReader()
                          r.onload = () => resolve(r.result.split(',')[1])
                          r.readAsDataURL(blob)
                        })
                      } catch (e) { console.error('Failed to read generated preview:', e) }
                    }

                    if (postDests.ig_post) {
                      // Use processed video for reels (if available), otherwise let backend process
                      const useProcessed = hasOverlays && processedBase64
                      const b64 = useProcessed ? processedBase64 : rawBase64
                      const mt = useProcessed ? 'video/mp4' : rawType
                      const overlayOpts = useProcessed ? {} : (hasOverlays ? { caption_style: 'overlay', overlay_y_pct: overlayYPct, font_size: storyFontSize, font_color: storyFontColor, font_outline: storyFontOutline, opening_text: openingText, closing_text: closingText, opening_duration: openingDuration, closing_duration: closingDuration } : {})
                      try { await api.postToInstagram(value, b64, mt, overlayOpts); results.push('IG') } catch (e) { results.push(`IG failed: ${e.message}`) }
                    }
                    if (postDests.ig_story) {
                      const useProcessed = hasOverlays && processedBase64
                      const b64 = useProcessed ? processedBase64 : rawBase64
                      const mt = useProcessed ? 'video/mp4' : rawType
                      const cs = useProcessed ? 'none' : storyCaptionStyle
                      try { await api.postToInstagramStory(storyCaptionStyle === 'overlay' ? storyText : value, b64, mt, cs, overlayYPct, useProcessed ? {} : fontOpts); results.push('IG Story') } catch (e) { results.push(`IG Story failed: ${e.message}`) }
                    }
                    if (postDests.fb_post) {
                      // FB post always gets raw video, no overlays
                      try { await api.postToFacebook(value, rawBase64, rawType); results.push('FB') } catch (e) { results.push(`FB failed: ${e.message}`) }
                    }
                    if (postDests.fb_reel) {
                      const useProcessed = hasOverlays && processedBase64
                      const b64 = useProcessed ? processedBase64 : rawBase64
                      const mt = useProcessed ? 'video/mp4' : rawType
                      const overlayOpts = useProcessed ? {} : (hasOverlays ? { caption_style: 'overlay', overlay_y_pct: overlayYPct, font_size: storyFontSize, font_color: storyFontColor, font_outline: storyFontOutline, opening_text: openingText, closing_text: closingText, opening_duration: openingDuration, closing_duration: closingDuration } : {})
                      try { await api.postToFacebookReel(value, b64, mt, overlayOpts); results.push('FB Reel') } catch (e) { results.push(`FB Reel failed: ${e.message}`) }
                    }
                    if (postDests.fb_story) {
                      const useProcessed = hasOverlays && processedBase64
                      const b64 = useProcessed ? processedBase64 : rawBase64
                      const mt = useProcessed ? 'video/mp4' : rawType
                      const cs = useProcessed ? 'none' : storyCaptionStyle
                      try { await api.postToFacebookStory(storyCaptionStyle === 'overlay' ? storyText : value, b64, mt, cs, overlayYPct, useProcessed ? {} : fontOpts); results.push('FB Story') } catch (e) { results.push(`FB Story failed: ${e.message}`) }
                    }
                    if (postDests.yt_shorts) {
                      const useProcessed = hasOverlays && processedBase64
                      const b64 = useProcessed ? processedBase64 : rawBase64
                      const mt = useProcessed ? 'video/mp4' : rawType
                      const ytCaption = JSON.stringify({ title: title || item.file?.name || 'Short', description: value, tags })
                      const overlayOpts = useProcessed ? {} : (hasOverlays ? { caption_style: 'overlay', overlay_y_pct: overlayYPct, font_size: storyFontSize, font_color: storyFontColor, font_outline: storyFontOutline, opening_text: openingText, closing_text: closingText, opening_duration: openingDuration, closing_duration: closingDuration } : {})
                      try { await api.postToYoutubeShorts(ytCaption, b64, mt, overlayOpts); results.push('YT Shorts') } catch (e) { results.push(`YT Shorts failed: ${e.message}`) }
                    }
                    if (postDests.yt_video) {
                      const ytCaption = JSON.stringify({ title: title || item.file?.name || 'Video', description: value, tags })
                      try { await api.postToYoutubeVideo(ytCaption, rawBase64, rawType); results.push('YT Video') } catch (e) { results.push(`YT Video failed: ${e.message}`) }
                    }
                    if (postDests.twitter) {
                      try { await api.postToTwitter(value, rawBase64, rawType); results.push('X') } catch (e) { results.push(`X failed: ${e.message}`) }
                    }
                    if (postDests.tiktok) {
                      const r = await api.postToTiktok(value, rawBase64, rawType)
                      if (r.fallback) { navigator.clipboard.writeText(value); results.push('TikTok (caption copied)') }
                      else results.push('TikTok')
                    }
                    if (postDests.google) {
                      try { await api.postToGoogle(value, rawBase64, rawType); results.push('Google') } catch (e) { results.push(`Google failed: ${e.message}`) }
                    }
                    if (postDests.pinterest) {
                      try { await api.postToPinterest(value, rawBase64, rawType); results.push('Pinterest') } catch (e) { results.push(`Pinterest failed: ${e.message}`) }
                    }
                    if (postDests.blog) {
                      const wpTitle = title || item.file?.name?.replace(/\.[^.]+$/, '') || 'New Post'
                      try { await api.postToWordPress(wpTitle, value, rawBase64, rawType, [], false); results.push('Blog (draft)') } catch (e) { results.push(`Blog failed: ${e.message}`) }
                    }
                    setPostStatus(`Posted: ${results.join(', ')}`)
                  } catch (err) { setPostStatus(`Failed: ${err.message}`) }
                  setPosting(false)
                }}
                disabled={posting}
                className="mt-2 w-full text-[12px] py-2 border border-[#2D9A5E] rounded-sm bg-[#2D9A5E] text-white cursor-pointer font-sans font-medium hover:bg-[#258a50] disabled:opacity-50"
              >
                {posting ? 'Posting...' : `Post to ${[postDests.ig_post && (isVideoFile ? 'IG Reel' : 'IG'), postDests.ig_story && 'IG Story', postDests.fb_post && 'FB', postDests.fb_reel && 'FB Reel', postDests.fb_story && 'FB Story', postDests.yt_shorts && 'YT Shorts', postDests.yt_video && 'YT Video', postDests.twitter && 'X', postDests.tiktok && 'TikTok', postDests.google && 'Google', postDests.pinterest && 'Pinterest', postDests.blog && 'Blog'].filter(Boolean).join(' + ') || 'none'}`}
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-1.5 mt-2 items-center flex-wrap">
        {!canPostYt && platform === 'youtube' && !isVideo && (
          <span className="text-[10px] text-muted italic">YouTube requires a video</span>
        )}
        <button onClick={onRegen} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Regenerate</button>
        <button onClick={() => navigator.clipboard.writeText(value)} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Copy</button>
        <button onClick={() => onRefine(value)} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Refine</button>
        {saved && <span className="text-[10px] text-sage">Saved</span>}
        {postStatus && <span className={`text-[10px] ${postStatus.startsWith('Failed') ? 'text-[#c0392b]' : postStatus.startsWith('Warning') ? 'text-[#856404]' : 'text-sage'}`}>{postStatus}</span>}
        {scoreLabel && (
          <span
            onClick={() => setShowAiAnalysis(!showAiAnalysis)}
            className={`text-[10px] py-0.5 px-2 rounded-xl font-semibold border cursor-pointer hover:opacity-80 ${
              humanScore >= 70 ? 'bg-[#e8efe9] text-[#3a6b42] border-[#3a6b42]' :
              humanScore >= 40 ? 'bg-[#fef3cd] text-[#856404] border-[#856404]' :
              'bg-[#fdeaea] text-[#c0392b] border-[#c0392b]'
            }`}
            title="Click to see AI analysis"
          >
            {scoreLabel} {humanScore}%
          </span>
        )}
        </div>

        {/* AI Analysis popup */}
        {showAiAnalysis && score && (
          <div className="mt-2 border border-border rounded bg-[#fafafa] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-ink">AI Detection Analysis</span>
              <button onClick={() => setShowAiAnalysis(false)} className="text-muted text-sm bg-transparent border-none cursor-pointer">&times;</button>
            </div>
            {/* Reasons */}
            {score.reason && score.reason !== 'Looks human' && (
              <div className="mb-2">
                <p className="text-[10px] text-muted font-medium mb-1">Flags:</p>
                <div className="flex flex-wrap gap-1">
                  {score.reason.split('; ').map((r, i) => (
                    <span key={i} className="text-[9px] py-0.5 px-1.5 rounded bg-[#fdeaea] text-[#c0392b] border border-[#f5c6cb]">{r}</span>
                  ))}
                </div>
              </div>
            )}
            {/* Highlighted text */}
            <div className="text-[11px] leading-relaxed whitespace-pre-wrap text-ink bg-white border border-border rounded p-2 max-h-[200px] overflow-y-auto">
              {(() => {
                const aiWords = new Set([
                  'delve','tapestry','vibrant','journey','landscape','elevate','foster',
                  'moreover','furthermore','utilize','harness','leverage','paramount',
                  'multifaceted','comprehensive','innovative','streamline','optimize',
                  'unlock','empower','transform','enhance','curate','craft','elevating',
                  'stunning','incredible','amazing','perfect','exclusive','ideal',
                  'haven','nestled','bespoke','artisan','artisanal','immerse',
                  'captivating','exquisite','unparalleled','seamless','holistic',
                ])
                const ctaPhrases = ['book now','don\'t miss','limited time','act now','sign up today','what are you waiting for','treat yourself','you deserve']
                const allPatterns = [...ctaPhrases, ...Array.from(aiWords)].sort((a, b) => b.length - a.length)
                const regex = new RegExp(`(\\b(?:${allPatterns.join('|')})\\b)`, 'gi')
                return value.split(regex).map((part, i) =>
                  aiWords.has(part.toLowerCase()) || ctaPhrases.some(p => part.toLowerCase() === p)
                    ? <mark key={i} className="bg-[#fce4ec] text-[#c0392b] rounded px-0.5 font-medium" title="AI-typical">{part}</mark>
                    : <span key={i}>{part}</span>
                )
              })()}
            </div>
            {score.reason === 'Looks human' && (
              <p className="text-[10px] text-[#3a6b42] mt-1">No AI patterns detected — this content looks human-written.</p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
