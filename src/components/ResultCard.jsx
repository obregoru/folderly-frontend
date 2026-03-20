import { useState, useEffect, useCallback } from 'react'
import { allTags } from '../lib/parse'
import { CROP_RATIOS, smartCrop, applyWatermark } from '../lib/crop'
import CropStrip from './CropStrip'

// Map platform to preferred crop ratio
const PLATFORM_CROPS = {
  tiktok: CROP_RATIOS.find(c => c.label.startsWith('TikTok')),
  instagram: CROP_RATIOS.find(c => c.label === 'IG Square 1:1'),
  facebook: CROP_RATIOS.find(c => c.label.startsWith('FB')),
  twitter: CROP_RATIOS.find(c => c.label.startsWith('X ')),
  google: CROP_RATIOS.find(c => c.label.startsWith('Google')),
  blog: CROP_RATIOS.find(c => c.label.startsWith('FB')), // 16:9 for blog featured images
}

const PLATFORMS = [
  { key: 'tiktok', label: 'TikTok', color: '#2D9A5E' },
  { key: 'instagram', label: 'Instagram', color: '#B5318A' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2' },
  { key: 'twitter', label: 'X', color: '#000000' },
  { key: 'google', label: 'Google', color: '#4285F4' },
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

export default function ResultCard({ item, folderCtx, onRegen, onUpdateCaption, onRefine, apiUrl, settings }) {
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

  return (
    <div className="bg-white border border-border rounded mb-2.5">
      {/* Header */}
      <div className="flex items-center gap-2.5 py-2.5 px-3.5 border-b border-border bg-cream">
        {thumbSrc ? (
          <img src={thumbSrc} className="w-9 h-9 rounded-sm object-cover flex-shrink-0" />
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
        <PostAllBar item={item} available={available} settings={settings} apiUrl={apiUrl} />
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

const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', blog: 'WordPress', tiktok: 'TikTok', google: 'Google' }
const PLATFORM_COLORS = { facebook: '#1877F2', instagram: '#E1306C', twitter: '#000', blog: '#21759B', tiktok: '#2D9A5E', google: '#4285F4' }

function PostAllBar({ item, available, settings, apiUrl }) {
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

  const hasWp = available.some(p => p.key === 'blog') && settings?.wp_site_url
  useEffect(() => {
    if (hasWp && !wpCatsLoaded) {
      import('../api').then(api => api.getWpCategories()).then(cats => {
        if (Array.isArray(cats)) setWpCategories(cats)
        setWpCatsLoaded(true)
      }).catch(() => setWpCatsLoaded(true))
    }
  }, [hasWp, wpCatsLoaded])

  // Determine which platforms can actually post
  const postable = available.filter(p => {
    if (p.key === 'facebook' && settings?.fb_connected) return true
    if (p.key === 'instagram' && settings?.ig_connected) return true
    if (p.key === 'twitter' && settings?.twitter_connected) return true
    if (p.key === 'google' && settings?.google_connected) return true
    if (p.key === 'blog' && settings?.wp_site_url) return true
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

      const post = { platform: p.key, caption, image_base64: imageBase64, media_type: mediaType }
      if (p.key === 'blog') {
        const blogCap = item.captions[p.key]
        post.title = getTitle(blogCap) || item.name || item.file?.name?.replace(/\.[^.]+$/, '') || 'New Post'
        post.wp_publish = wpPublishAll
        post.wp_category_ids = selectedCats
      }
      posts.push(post)
    }
    return posts
  }

  const handleScheduleAll = async () => {
    if (!scheduleDate) return
    setScheduling(true)
    setScheduleStatus('')
    try {
      const api = await import('../api')
      const posts = await buildPostsPayload()
      const result = await api.schedulePosts(posts, new Date(scheduleDate).toISOString())
      setScheduleStatus(`Scheduled ${result.scheduled.length} posts`)
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
          onClick={() => setShowSchedule(!showSchedule)}
          disabled={posting || scheduling}
          className="text-[11px] py-1.5 px-3 rounded-sm bg-[#6C5CE7] text-white cursor-pointer font-sans font-medium hover:bg-[#5a4bd6] disabled:opacity-50 border-none"
        >
          Schedule
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
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input
            type="datetime-local"
            value={scheduleDate}
            onChange={e => setScheduleDate(e.target.value)}
            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
            className="text-xs border border-border rounded px-2 py-1 bg-white"
          />
          <button
            onClick={handleScheduleAll}
            disabled={scheduling || !scheduleDate}
            className="text-[11px] py-1 px-2.5 rounded-sm bg-[#6C5CE7] text-white cursor-pointer font-sans hover:bg-[#5a4bd6] disabled:opacity-50 border-none"
          >
            {scheduling ? 'Scheduling...' : `Schedule All (${postable.length})`}
          </button>
          <button
            onClick={() => { setShowSchedule(false); setScheduleDate('') }}
            className="text-[10px] text-muted hover:underline"
          >Cancel</button>
        </div>
      )}
    </div>
  )
}

function CaptionEditor({ text, blogTitle, ytTags, captionId, score, platform, item, settings, onSave, onRegen, onRefine }) {
  const [value, setValue] = useState(text)
  const [title, setTitle] = useState(blogTitle || '')
  const [tags, setTags] = useState(ytTags || [])
  const [saved, setSaved] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postStatus, setPostStatus] = useState('')
  const [storyEnabled, setStoryEnabled] = useState(false)
  const [storyCaptionStyle, setStoryCaptionStyle] = useState('none')
  const [storyPreview, setStoryPreview] = useState(null)

  // Sync when text prop changes (e.g. after refine/regen)
  useEffect(() => { setValue(text) }, [text])
  useEffect(() => { setTitle(blogTitle || '') }, [blogTitle])
  useEffect(() => { setTags(ytTags || []) }, [ytTags])

  // Generate story preview when enabled
  useEffect(() => {
    if (!storyEnabled || !item.isImg) { setStoryPreview(null); return }
    let cancelled = false
    const { smartCrop, STORY_RATIO } = require('../lib/crop')
    smartCrop(item, STORY_RATIO || { w: 1080, h: 1920 }).then(blob => {
      if (cancelled) return
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 1080; canvas.height = 1920
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, 1080, 1920)

        if (storyCaptionStyle === 'overlay' && value) {
          // Draw gradient bar + text
          const firstSentence = value.split(/[.!?]\s/)[0].replace(/[.!?]$/, '').trim()
          if (firstSentence) {
            const words = firstSentence.split(' ')
            const lines = []
            let line = ''
            for (const w of words) {
              if ((line + ' ' + w).trim().length > 30 && line) { lines.push(line.trim()); line = w }
              else line = (line + ' ' + w).trim()
            }
            if (line) lines.push(line.trim())

            const fontSize = 48
            const lineH = fontSize * 1.4
            const blockH = lines.length * lineH + 60
            const gradTop = 1920 - blockH - 80

            // Gradient
            const grad = ctx.createLinearGradient(0, gradTop, 0, 1920)
            grad.addColorStop(0, 'rgba(0,0,0,0)')
            grad.addColorStop(0.3, 'rgba(0,0,0,0.6)')
            grad.addColorStop(1, 'rgba(0,0,0,0.8)')
            ctx.fillStyle = grad
            ctx.fillRect(0, gradTop, 1080, 1920 - gradTop)

            // Text
            ctx.font = `600 ${fontSize}px sans-serif`
            ctx.fillStyle = 'white'
            ctx.textAlign = 'center'
            ctx.shadowColor = 'rgba(0,0,0,0.7)'
            ctx.shadowBlur = 6
            ctx.shadowOffsetY = 2
            lines.forEach((l, i) => {
              ctx.fillText(l, 540, gradTop + 50 + (i * lineH) + fontSize)
            })
          }
        }

        canvas.toBlob(b => {
          if (!cancelled) setStoryPreview(URL.createObjectURL(b))
        }, 'image/jpeg', 0.8)
      }
      img.src = URL.createObjectURL(blob)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [storyEnabled, storyCaptionStyle, value, item])

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
  const canPostWp = platform === 'blog' && settings?.wp_site_url
  const [wpCategories, setWpCategories] = useState([])
  const [selectedCats, setSelectedCats] = useState([])
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

  const getImageBase64 = async (targetPlatform) => {
    if (!item.isImg || !item.file) return { imageBase64: null, mediaType: null }
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

  const handlePost = async (target) => {
    setPosting(true)
    setPostStatus('')
    try {
      const { imageBase64, mediaType } = await getImageBase64(target)
      const api = await import('../api')
      if (target === 'facebook') {
        await api.postToFacebook(value, imageBase64, mediaType)
        setPostStatus('Posted!')
      } else if (target === 'instagram_story') {
        if (!imageBase64) throw new Error('Instagram Stories requires a photo')
        await api.postToInstagramStory(value, imageBase64, mediaType, storyCaptionStyle)
        setPostStatus('Story posted!')
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
      } else if (target === 'google') {
        await api.postToGoogle(value, imageBase64, mediaType)
        setPostStatus('Posted to Google!')
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
        className={`w-full text-xs leading-relaxed whitespace-pre-wrap text-ink border rounded-sm py-1.5 px-2 font-sans resize-y min-h-[60px] bg-transparent transition-all hover:border-border focus:outline-none focus:border-sage focus:bg-white ${charLimit && value.length > charLimit ? 'border-[#c0392b]' : 'border-transparent'}`}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleBlur}
        rows={Math.max(3, Math.ceil(value.length / 60))}
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
          <button
            onClick={() => handlePost('facebook')}
            disabled={posting}
            className="text-[11px] py-1 px-2.5 border border-[#1877F2] rounded-sm bg-[#1877F2] text-white cursor-pointer font-sans hover:bg-[#1565c0] disabled:opacity-50"
          >
            {posting ? 'Posting...' : 'Post to Facebook'}
          </button>
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
        {canPostIg && (
          <div className="w-full flex flex-col gap-1 mt-1 border-t border-border pt-1.5">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={storyEnabled} onChange={e => setStoryEnabled(e.target.checked)} />
              <span>Instagram Stories</span>
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
                {storyPreview && (
                  <div className="ml-5 mt-1.5">
                    <p className="text-[10px] text-muted mb-1">Story preview</p>
                    <img src={storyPreview} className="w-[120px] h-[213px] object-cover rounded border border-border" alt="Story preview" />
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
        {canPostGoogle && (
          <button
            onClick={() => handlePost('google')}
            disabled={posting}
            className="text-[11px] py-1 px-2.5 border border-[#4285F4] rounded-sm bg-[#4285F4] text-white cursor-pointer font-sans hover:bg-[#3574d4] disabled:opacity-50"
          >
            {posting ? 'Posting...' : 'Post to Google'}
          </button>
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
